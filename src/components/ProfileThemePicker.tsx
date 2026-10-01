import { useEffect, useRef, useState } from 'react';
import { Check, ChevronLeft, ChevronRight, LoaderCircle, Palette, RotateCcw, Search, X } from 'lucide-react';

type SteamProfileTheme = {
	id: string;
	name: string;
	game: string;
	appid: number;
	communityItemType: number;
	profileThemeId: string;
	imageUrl: string;
	thumbnailUrl: string;
};

export type AppliedProfileTheme = {
	id: string;
	name: string;
	themeClass?: string;
	variables: Record<string, string>;
};

type ProfileThemeResponse = {
	items: SteamProfileTheme[];
	totalCount: number;
	pageSize: number;
	nextCursor?: string | null;
	error?: string;
};

type ProfileThemeStyleResponse = {
	variables: Record<string, string>;
	error?: string;
};

type ProfileThemePickerProps = {
	value: AppliedProfileTheme | null;
	onApply: (theme: AppliedProfileTheme | null) => void;
};

export default function ProfileThemePicker({ value, onApply }: ProfileThemePickerProps) {
	const [expanded, setExpanded] = useState(false);
	const [page, setPage] = useState(0);
	const [items, setItems] = useState<SteamProfileTheme[]>([]);
	const [totalCount, setTotalCount] = useState(0);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState('');
	const [query, setQuery] = useState('');
	const [applyingThemeId, setApplyingThemeId] = useState<string | null>(null);
	const cursors = useRef<Array<string | null>>([null]);
	const dialogRef = useRef<HTMLDialogElement>(null);

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
		const url = cursor ? `/api/profile-themes?${new URLSearchParams({ cursor })}` : '/api/profile-themes';
		setLoading(true);
		setError('');
		fetch(url, { signal: controller.signal, cache: 'no-cache' })
			.then(async (response) => {
				const result = await response.json() as ProfileThemeResponse;
				if (!response.ok) throw new Error(result.error || 'Could not load Steam profile themes.');
				return result;
			})
			.then((result) => {
				setItems(result.items);
				setTotalCount(result.totalCount);
				cursors.current[page + 1] = result.nextCursor || null;
			})
			.catch((caught: unknown) => {
				if (caught instanceof DOMException && caught.name === 'AbortError') return;
				setError(caught instanceof Error ? caught.message : 'Could not load Steam profile themes.');
				setItems([]);
				setTotalCount(0);
			})
			.finally(() => {
				if (!controller.signal.aborted) setLoading(false);
			});
		return () => controller.abort();
	}, [expanded, page]);

	async function applyTheme(theme: SteamProfileTheme) {
		setApplyingThemeId(theme.id);
		setError('');
		try {
			if (theme.profileThemeId !== 'GameProfile') {
				onApply({ id: theme.id, name: theme.name, themeClass: `${theme.profileThemeId}Theme`, variables: {} });
				setExpanded(false);
				return;
			}

			const params = new URLSearchParams({ appid: String(theme.appid), itemtype: String(theme.communityItemType) });
			const response = await fetch(`/api/profile-theme-style?${params}`, { cache: 'no-cache' });
			const result = await response.json() as ProfileThemeStyleResponse;
			if (!response.ok) throw new Error(result.error || 'Could not load the Steam profile theme.');
			onApply({ id: theme.id, name: theme.name, variables: result.variables });
			setExpanded(false);
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : 'Could not load the Steam profile theme.');
		} finally {
			setApplyingThemeId(null);
		}
	}

	const visibleItems = query.trim()
		? items.filter((item) => `${item.name} ${item.game}`.toLowerCase().includes(query.trim().toLowerCase()))
		: items;
	const pageCount = Math.ceil(totalCount / 20);

	return (
		<section className="profile-theme-picker" aria-labelledby="profile-theme-picker-title">
			<div className="profile-theme-picker-heading">
				<span className="source-label" id="profile-theme-picker-title">PROFILE THEME</span>
			</div>
			<div className="profile-theme-current-row">
				<span className="profile-theme-mark" aria-hidden="true"><Palette size={19} /></span>
				<div className="background-current-actions">
					<span className="background-current-name">{value?.name || 'Original profile theme'}</span>
					<button className="avatar-upload-button" type="button" onClick={() => setExpanded(true)}>
						<Palette size={14} /> Browse profile themes
					</button>
				</div>
				{value && <button className="icon-button" type="button" title="Restore original profile theme" aria-label="Restore original profile theme" onClick={() => onApply(null)}><RotateCcw size={15} /></button>}
			</div>

			<dialog
				ref={dialogRef}
				className="background-dialog profile-theme-dialog"
				aria-labelledby="profile-theme-dialog-title"
				onClose={() => setExpanded(false)}
				onCancel={(event) => { event.preventDefault(); setExpanded(false); }}
				onClick={(event) => { if (event.target === event.currentTarget) setExpanded(false); }}
			>
				<div className="background-dialog-content">
					<header className="background-dialog-header">
						<div>
							<span className="source-label">STEAM POINTS SHOP</span>
							<h2 id="profile-theme-dialog-title">Game Profiles</h2>
							<p className="profile-theme-note">Apply the Steam theme to profile content only. Avatar and profile background stay unchanged.</p>
						</div>
						<button className="icon-button" type="button" title="Close profile themes" aria-label="Close profile themes" onClick={() => setExpanded(false)}><X size={18} /></button>
					</header>

					<form className="background-search is-large" onSubmit={(event) => event.preventDefault()}>
						<Search size={17} aria-hidden="true" />
						<input aria-label="Filter profile themes" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter themes on this page" maxLength={80} autoFocus={expanded} />
					</form>

					{error && <p className="background-error" role="alert">{error}</p>}
					<div className="background-results is-expanded profile-theme-results" aria-busy={loading}>
						{visibleItems.map((theme) => (
							<button
								className="profile-theme-option"
								key={theme.id}
								type="button"
								aria-pressed={value?.id === theme.id}
								disabled={!!applyingThemeId}
								title={`Apply ${theme.name} to preview`}
								aria-label={`Apply ${theme.name} to profile preview`}
								onClick={() => void applyTheme(theme)}
							>
								<img src={theme.imageUrl} alt="" loading="lazy" />
								<span className="profile-theme-option-name">{theme.name}</span>
								<span className="profile-theme-option-game">{theme.game}</span>
								<span className="profile-theme-option-action">{applyingThemeId === theme.id ? <><LoaderCircle className="spin" size={12} /> Applying</> : value?.id === theme.id ? <><Check size={12} /> Applied to preview</> : 'Apply to preview'}</span>
							</button>
						))}
						{loading && <div className="background-loading"><LoaderCircle className="spin" size={24} /></div>}
						{!loading && !error && visibleItems.length === 0 && <p className="background-empty">No matching profile themes on this page.</p>}
					</div>

					<div className="background-picker-footer is-large">
						<span>{totalCount.toLocaleString()} game profiles</span>
						<div className="background-pagination">
							<button type="button" aria-label="Previous profile themes" disabled={page === 0 || loading} onClick={() => setPage((current) => current - 1)}><ChevronLeft size={18} /></button>
							<span>{pageCount ? `${page + 1} / ${pageCount.toLocaleString()}` : '0 / 0'}</span>
							<button type="button" aria-label="Next profile themes" disabled={loading || !cursors.current[page + 1]} onClick={() => setPage((current) => current + 1)}><ChevronRight size={18} /></button>
						</div>
					</div>
				</div>
			</dialog>
		</section>
	);
}
