import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ChevronLeft, ChevronRight, ExternalLink, ImagePlus, LoaderCircle, RotateCcw, Search, X } from 'lucide-react';
import { fetchWithRetry } from '../utils/fetchWithRetry';

export type SteamAvatarFrame = {
	id: string;
	name: string;
	game: string;
	imageUrl: string;
	thumbnailUrl: string;
	steamUrl: string;
	animatedImageUrl?: string;
	animated: boolean;
};

type AvatarFrameResponse = {
	items: SteamAvatarFrame[];
	totalCount: number;
	pageSize: number;
	nextCursor?: string | null;
	catalogIndexed?: boolean;
	error?: string;
};

type AvatarFramePickerProps = {
	sourceAvatar?: string;
	sourceFrameImage: string;
	value: SteamAvatarFrame | null;
	onChange: (frame: SteamAvatarFrame | null) => void;
};

export default function AvatarFramePicker({ sourceAvatar, sourceFrameImage, value, onChange }: AvatarFramePickerProps) {
	const [query, setQuery] = useState('');
	const [submittedQuery, setSubmittedQuery] = useState('');
	const [page, setPage] = useState(0);
	const [items, setItems] = useState<SteamAvatarFrame[]>([]);
	const [totalCount, setTotalCount] = useState(0);
	const [loading, setLoading] = useState(false);
	const [retryAttempt, setRetryAttempt] = useState(0);
	const [error, setError] = useState('');
	const [expanded, setExpanded] = useState(false);
	const [catalogIndexed, setCatalogIndexed] = useState(false);
	const dialogRef = useRef<HTMLDialogElement>(null);
	const cursors = useRef<Array<string | null>>([null]);
	const catalogIndexedRef = useRef(false);
	const pageSize = 20;

	useEffect(() => {
		const dialog = dialogRef.current;
		if (!dialog) return;
		if (expanded && !dialog.open) dialog.showModal();
		if (!expanded && dialog.open) dialog.close();
	}, [expanded]);

	useEffect(() => {
		if (!expanded) return;

		const controller = new AbortController();
		const cursor = cursors.current[page];
		const params = new URLSearchParams();
		if (submittedQuery) params.set('query', submittedQuery);
		if (catalogIndexedRef.current) params.set('page', String(page));
		else if (cursor) params.set('cursor', cursor);
		const url = `/api/avatar-frames${params.toString() ? `?${params}` : ''}`;
		setLoading(true);
		setRetryAttempt(0);
		setError('');
		fetchWithRetry(url, { signal: controller.signal }, { onRetry: setRetryAttempt })
			.then(async (response) => {
				const result = await response.json() as AvatarFrameResponse;
				if (!response.ok) throw new Error(result.error || 'Could not load Steam avatar frames.');
				return result;
			})
			.then((result) => {
				setItems(result.items);
				setTotalCount(result.totalCount);
				catalogIndexedRef.current = Boolean(result.catalogIndexed);
				setCatalogIndexed(catalogIndexedRef.current);
				cursors.current[page + 1] = result.nextCursor || null;
			})
			.catch((caught: unknown) => {
				if (caught instanceof DOMException && caught.name === 'AbortError') return;
				setError(caught instanceof Error ? caught.message : 'Could not load Steam avatar frames.');
				setItems([]);
				setTotalCount(0);
			})
			.finally(() => {
				if (!controller.signal.aborted) {
					setLoading(false);
					setRetryAttempt(0);
				}
			});

		return () => controller.abort();
	}, [expanded, page, submittedQuery]);

	function searchFrames(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		setPage(0);
		cursors.current = [null];
		catalogIndexedRef.current = false;
		setCatalogIndexed(false);
		setSubmittedQuery(query.trim());
	}

	function resetFrames() {
		setQuery('');
		setSubmittedQuery('');
		setPage(0);
		cursors.current = [null];
		catalogIndexedRef.current = false;
		setCatalogIndexed(false);
		onChange(null);
	}

	const visibleItems = submittedQuery
		? items.filter((item) => item.name.toLowerCase().includes(submittedQuery.toLowerCase()))
		: items;
	const pageCount = Math.ceil(totalCount / pageSize);
	const currentFrameUrl = value?.imageUrl || sourceFrameImage;
	const currentFrameName = value?.name || (sourceFrameImage ? 'Current avatar frame' : 'No frame on avatar');
	const steamUrl = value?.steamUrl || (value
		? `https://store.steampowered.com/points/shop/app/${value.game}`
		: '');

	return (
		<section className="avatar-frame-picker" aria-labelledby="avatar-frame-picker-title">
			<div className="avatar-frame-picker-heading">
				<span className="source-label" id="avatar-frame-picker-title">AVATAR FRAME</span>
				<button className="icon-button" type="button" title="Reset avatar frame" aria-label="Reset avatar frame" onClick={resetFrames} disabled={!value}>
					<RotateCcw size={15} />
				</button>
			</div>

			<div className="avatar-frame-current-row">
				<div className="avatar-frame-preview" role="img" aria-label={currentFrameName}>
					{sourceAvatar && <img className="avatar-frame-portrait" src={sourceAvatar} alt="" />}
					{value?.animatedImageUrl ? (
						<picture className="avatar-frame-overlay-picture">
							<source media="(prefers-reduced-motion: no-preference)" srcSet={value.animatedImageUrl} />
							<img className="avatar-frame-overlay" src={value.imageUrl} alt="" />
						</picture>
					) : currentFrameUrl && <img className="avatar-frame-overlay" src={currentFrameUrl} alt="" />}
				</div>
				<div className="background-current-actions">
					<span className="background-current-name" title={currentFrameName}>{currentFrameName}</span>
					<button className="avatar-upload-button" type="button" onClick={() => setExpanded(true)}>
						<ImagePlus size={14} /> Replace frame
					</button>
						{steamUrl && <a className="steam-item-link" href={steamUrl} target="_blank" rel="noopener noreferrer"><ExternalLink size={13} /> View on Steam</a>}
				</div>
			</div>

			<dialog
				ref={dialogRef}
				className="background-dialog avatar-frame-dialog"
				aria-labelledby="avatar-frame-dialog-title"
				onClose={() => setExpanded(false)}
				onCancel={(event) => { event.preventDefault(); setExpanded(false); }}
				onClick={(event) => { if (event.target === event.currentTarget) setExpanded(false); }}
			>
				<div className="background-dialog-content">
					<header className="background-dialog-header">
						<div>
							<span className="source-label">STEAM POINTS SHOP</span>
							<h2 id="avatar-frame-dialog-title">Avatar frames</h2>
							{value && <p className="background-selection" title={value.name}>Selected: {value.name}</p>}
						</div>
						<button className="icon-button" type="button" title="Close avatar frames" aria-label="Close avatar frames" onClick={() => setExpanded(false)}>
							<X size={18} />
						</button>
					</header>

					<form className="background-search is-large" onSubmit={searchFrames}>
						<Search size={17} aria-hidden="true" />
						<input aria-label="Search avatar frames" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search avatar frames" maxLength={80} autoFocus={expanded} />
						<button type="submit" aria-label="Filter avatar frames"><Search size={17} /></button>
					</form>

					{error && <p className="background-error" role="alert">{error}</p>}
					<div className="background-results is-expanded avatar-frame-results" aria-busy={loading}>
						{visibleItems.map((frame) => (
							<button
								className={`avatar-frame-option ${value?.id === frame.id ? 'is-selected' : ''}`}
								type="button"
								key={frame.id}
								title={frame.name}
								aria-label={`Preview ${frame.name}${frame.animated ? ', animated' : ''}`}
								aria-pressed={value?.id === frame.id}
								onClick={() => { onChange(frame); setExpanded(false); }}
							>
								<span className="avatar-frame-option-preview">
									{sourceAvatar && <img className="avatar-frame-portrait" src={sourceAvatar} alt="" />}
									<picture className="avatar-frame-overlay-picture">
										{frame.animatedImageUrl && <source media="(prefers-reduced-motion: no-preference)" srcSet={frame.animatedImageUrl} />}
										<img className="avatar-frame-overlay" src={frame.imageUrl} alt="" loading="lazy" />
									</picture>
								</span>
								<span className="avatar-frame-option-name">{frame.name}</span>
								{frame.animated && <span className="avatar-frame-animation-mark">ANIMATED</span>}
							</button>
						))}
						{loading && <div className="background-loading"><span><LoaderCircle className="spin" size={24} />{retryAttempt > 0 && ` Retrying (${retryAttempt}/3)`}</span></div>}
						{!loading && !error && visibleItems.length === 0 && <p className="background-empty">No matching avatar frames.</p>}
					</div>

					<div className="background-picker-footer is-large">
						<span>{totalCount.toLocaleString()} frames</span>
						<div className="background-pagination">
							<button type="button" aria-label="Previous avatar frames" disabled={page === 0 || loading} onClick={() => setPage((current) => current - 1)}><ChevronLeft size={18} /></button>
							<span>{pageCount ? `${page + 1} / ${pageCount.toLocaleString()}` : '0 / 0'}</span>
							<button type="button" aria-label="Next avatar frames" disabled={loading || (catalogIndexed ? page + 1 >= pageCount : !cursors.current[page + 1])} onClick={() => setPage((current) => current + 1)}><ChevronRight size={18} /></button>
						</div>
					</div>
				</div>
			</dialog>
		</section>
	);
}