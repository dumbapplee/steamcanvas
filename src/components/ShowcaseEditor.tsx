import { useEffect, useState, type ChangeEvent } from 'react';
import { ArrowDown, ArrowUp, Download, ImagePlus, Plus, Trash2 } from 'lucide-react';
import { decompressFrames, parseGIF, type ParsedFrame } from 'gifuct-js';
import { applyPalette, GIFEncoder, quantize } from 'gifenc';

type ShowcaseKind = 'artwork' | 'featured-artwork' | 'other';

type ShowcaseEntry = {
	id: string;
	kind: ShowcaseKind;
	title: string;
	artworkTitle: string;
	artworkTitleHidden: boolean;
	exportFiles?: Array<{ name: string; url: string }>;
	animatedArtwork?: { name: string; url: string };
	element: HTMLElement;
};

type ShowcaseEditorProps = {
	previewDocument: Document | null;
	previewLevel: number;
	onPreviewLevelChange: (level: number) => void;
};

type ArtworkMosaic = {
	images: string[];
	animated?: { width: number; height: number; mainWidth: number; format: 'gif' | 'apng' };
};

function getShowcaseArea(document: Document | null, create = false): HTMLElement | null {
	const column = document?.querySelector<HTMLElement>('.profile_leftcol');
	if (!column || !document) return null;
	const existing = column.querySelector<HTMLElement>(':scope > .profile_customization_area');
	if (existing || !create) return existing || null;

	const area = document.createElement('div');
	area.className = 'profile_customization_area';
	column.append(area);
	return area;
}

function classifyShowcase(element: HTMLElement): ShowcaseKind {
	if (!element.classList.contains('myart')) return 'other';
	return element.querySelector('.screenshot_showcase_primary.single') ? 'featured-artwork' : 'artwork';
}

function getArtworkTitle(element: HTMLElement): string {
	return element.querySelector<HTMLElement>('.screenshot_showcase_itemname')?.textContent || '';
}

function isArtworkTitleHidden(title: string): boolean {
	return !title.replace(/[\s\u00ad\u115f\u1160\u3164\u2800]/gu, '');
}

function makeImageSlot(document: Document, className: string, maxWidth: number): HTMLElement {
	const slot = document.createElement('div');
	slot.className = className;
	slot.dataset.steamcanvasEmptySlot = 'true';
	const anchor = document.createElement('a');
	anchor.className = 'screenshot_showcase_screenshot modalContentLink';
	const image = document.createElement('img');
	image.alt = '';
	image.style.maxWidth = `${maxWidth}px`;
	image.style.width = '100%';
	image.style.minHeight = `${Math.round(maxWidth * 0.5625)}px`;
	image.style.background = 'linear-gradient(135deg, #263746, #4b6272)';
	image.src = `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${maxWidth}" height="${Math.round(maxWidth * 0.5625)}" viewBox="0 0 ${maxWidth} ${Math.round(maxWidth * 0.5625)}"><rect width="100%" height="100%" fill="#344b5b"/></svg>`)}`;
	image.dataset.steamcanvasArtwork = 'true';
	anchor.append(image);
	slot.append(anchor);
	return slot;
}

function makeArtworkShowcase(document: Document, kind: Exclude<ShowcaseKind, 'other'>): HTMLElement {
	const featured = kind === 'featured-artwork';
	const showcase = document.createElement('div');
	showcase.className = 'profile_customization myart';
	showcase.dataset.steamcanvasNewShowcase = 'true';

	const header = document.createElement('div');
	header.className = 'profile_customization_header';
	header.textContent = featured ? 'Featured Artwork Showcase' : 'Artwork Showcase';
	const block = document.createElement('div');
	block.className = 'profile_customization_block';
	const content = document.createElement('div');
	content.className = 'screenshot_showcase';

	const primary = makeImageSlot(document, `screenshot_showcase_primary${featured ? ' single' : ''} showcase_slot`, featured ? 630 : 506);
	if (featured) {
		const title = document.createElement('div');
		title.className = 'screenshot_showcase_itemname';
		primary.append(title);
		const stats = document.createElement('div');
		stats.className = 'screenshot_showcase_stats';
		primary.append(stats);
	} else {
		content.append(primary);
		const right = document.createElement('div');
		right.className = 'screenshot_showcase_rightcol';
		for (let index = 0; index < 3; index += 1) {
			right.append(makeImageSlot(document, 'screenshot_showcase_smallscreenshot showcase_slot', 100));
		}
		content.append(right);
		const clear = document.createElement('div');
		clear.style.clear = 'both';
		content.append(clear);
	}

	if (featured) content.append(primary);
	block.append(content);
	showcase.append(header, block);
	return showcase;
}

async function splitArtworkMosaic(file: File): Promise<ArtworkMosaic> {
	const dataUrl = await new Promise<string>((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Could not read artwork image.'));
		reader.onerror = () => reject(new Error('Could not read artwork image.'));
		reader.readAsDataURL(file);
	});

	const image = new Image();
	image.src = dataUrl;
	await image.decode();

	const showcaseWidth = 606;
	const mainWidth = 506;
	const scale = showcaseWidth / image.naturalWidth;
	const compositeWidth = Math.max(6, Math.round(image.naturalWidth * scale));
	const compositeHeight = Math.max(1, Math.round(image.naturalHeight * scale));
	const outputMainWidth = Math.max(1, Math.round(compositeWidth * mainWidth / showcaseWidth));
	const sideWidth = Math.max(1, compositeWidth - outputMainWidth);
	if (file.type === 'image/gif' || file.type === 'image/apng' || /\.(gif|apng)$/i.test(file.name)) {
		return {
			images: [dataUrl, dataUrl],
			animated: {
				width: compositeWidth,
				height: compositeHeight,
				mainWidth: outputMainWidth,
				format: file.type === 'image/gif' || /\.gif$/i.test(file.name) ? 'gif' : 'apng',
			},
		};
	}

	const composite = document.createElement('canvas');
	composite.width = compositeWidth;
	composite.height = compositeHeight;
	const context = composite.getContext('2d');
	if (!context) throw new Error('Could not prepare the artwork mosaic.');
	context.drawImage(image, 0, 0, compositeWidth, compositeHeight);

	const extractTile = (x: number, y: number, width: number, height: number) => {
		const tile = document.createElement('canvas');
		tile.width = width;
		tile.height = height;
		const tileContext = tile.getContext('2d');
		if (!tileContext) throw new Error('Could not prepare an artwork tile.');
		tileContext.drawImage(composite, x, y, width, height, 0, 0, width, height);
		return tile.toDataURL('image/png');
	};

	return {
		images: [
			extractTile(0, 0, outputMainWidth, compositeHeight),
			extractTile(outputMainWidth, 0, sideWidth, compositeHeight),
		],
	};
}

function readBlobDataUrl(blob: Blob): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Could not export animated artwork.'));
		reader.onerror = () => reject(new Error('Could not export animated artwork.'));
		reader.readAsDataURL(blob);
	});
}

async function encodeAnimatedMosaic(file: File, mosaic: NonNullable<ArtworkMosaic['animated']>): Promise<string[]> {
	const parsed = parseGIF(await file.arrayBuffer());
	const frames = decompressFrames(parsed, true);
	if (!frames.length) throw new Error('This GIF has no decodable frames.');

	const scale = mosaic.width / parsed.lsd.width;
	const mainCanvas = document.createElement('canvas');
	mainCanvas.width = mosaic.width;
	mainCanvas.height = mosaic.height;
	const mainContext = mainCanvas.getContext('2d', { willReadFrequently: true });
	if (!mainContext) throw new Error('Could not prepare animated artwork frames.');
	mainContext.imageSmoothingEnabled = false;

	const patchCanvas = document.createElement('canvas');
	const patchContext = patchCanvas.getContext('2d');
	if (!patchContext) throw new Error('Could not prepare animated artwork patches.');

	const panelWidths = [mosaic.mainWidth, mosaic.width - mosaic.mainWidth];
	const encoders = panelWidths.map(() => GIFEncoder({ initialCapacity: Math.max(4096, mosaic.width * mosaic.height) }));
	const panelCanvases = panelWidths.map((width) => {
		const canvas = document.createElement('canvas');
		canvas.width = width;
		canvas.height = mosaic.height;
		return canvas;
	});
	const panelContexts = panelCanvases.map((canvas) => canvas.getContext('2d', { willReadFrequently: true }));
	if (panelContexts.some((context) => !context)) throw new Error('Could not prepare animated mosaic panels.');

	const hasTransparency = frames.some((frame) => frame.transparentIndex >= 0);
	const backgroundColor = parsed.gct[parsed.lsd.backgroundColorIndex] || [255, 255, 255];
	if (!hasTransparency) {
		mainContext.fillStyle = `rgb(${backgroundColor[0]}, ${backgroundColor[1]}, ${backgroundColor[2]})`;
		mainContext.fillRect(0, 0, mosaic.width, mosaic.height);
	}

	let previousFrame: ParsedFrame | undefined;
	let restorePrevious: ImageData | undefined;
	function indexFrame(pixels: Uint8ClampedArray) {
		const transparent = pixels.some((_, index) => index % 4 === 3 && pixels[index] < 128);
		const maxOpaqueColors = transparent ? 255 : 256;
		const exactPalette: number[][] = [];
		const exactIndices = new Map<string, number>();
		let hasTooManyColors = false;
		for (let pixelOffset = 0; pixelOffset < pixels.length; pixelOffset += 4) {
			if (pixels[pixelOffset + 3] < 128) continue;
			const red = pixels[pixelOffset];
			const green = pixels[pixelOffset + 1];
			const blue = pixels[pixelOffset + 2];
			const key = `${red},${green},${blue}`;
			if (exactIndices.has(key)) continue;
			if (exactPalette.length === maxOpaqueColors) {
				hasTooManyColors = true;
				break;
			}
			exactIndices.set(key, exactPalette.length);
			exactPalette.push([red, green, blue]);
		}

		if (!hasTooManyColors) {
			const transparentIndex = transparent ? exactPalette.length : -1;
			const palette = transparent ? [...exactPalette, [0, 0, 0]] : exactPalette;
			const indexed = new Uint8Array(pixels.length / 4);
			for (let pixelOffset = 0; pixelOffset < pixels.length; pixelOffset += 4) {
				const index = pixelOffset / 4;
				if (pixels[pixelOffset + 3] < 128) {
					indexed[index] = transparentIndex;
				} else {
					indexed[index] = exactIndices.get(`${pixels[pixelOffset]},${pixels[pixelOffset + 1]},${pixels[pixelOffset + 2]}`) || 0;
				}
			}
			return { palette, indexed, transparentIndex };
		}

		const opaquePixels = new Uint8ClampedArray(pixels);
		for (let pixelOffset = 0; pixelOffset < opaquePixels.length; pixelOffset += 4) {
			if (opaquePixels[pixelOffset + 3] < 128) {
				opaquePixels[pixelOffset] = 0;
				opaquePixels[pixelOffset + 1] = 0;
				opaquePixels[pixelOffset + 2] = 0;
			}
			opaquePixels[pixelOffset + 3] = 255;
		}
		const opaquePalette = quantize(opaquePixels, maxOpaqueColors, { format: 'rgb565' });
		const indexed = applyPalette(opaquePixels, opaquePalette, 'rgb565');
		const transparentIndex = transparent ? opaquePalette.length : -1;
		if (transparent) {
			for (let pixelOffset = 0; pixelOffset < pixels.length; pixelOffset += 4) {
				if (pixels[pixelOffset + 3] < 128) indexed[pixelOffset / 4] = transparentIndex;
			}
		}
		return { palette: transparent ? [...opaquePalette, [0, 0, 0]] : opaquePalette, indexed, transparentIndex };
	}

	for (const [frameIndex, frame] of frames.entries()) {
		if (previousFrame?.disposalType === 2) {
			const { left, top, width, height } = previousFrame.dims;
			const x = Math.round(left * scale);
			const y = Math.round(top * scale);
			const w = Math.max(1, Math.round(width * scale));
			const h = Math.max(1, Math.round(height * scale));
			if (hasTransparency) mainContext.clearRect(x, y, w, h);
			else {
				mainContext.fillStyle = `rgb(${backgroundColor[0]}, ${backgroundColor[1]}, ${backgroundColor[2]})`;
				mainContext.fillRect(x, y, w, h);
			}
		} else if (previousFrame?.disposalType === 3 && restorePrevious) {
			mainContext.putImageData(restorePrevious, 0, 0);
		}

		const restoreCurrent = frame.disposalType === 3
			? mainContext.getImageData(0, 0, mosaic.width, mosaic.height)
			: undefined;
		patchCanvas.width = frame.dims.width;
		patchCanvas.height = frame.dims.height;
		const patchData = patchContext.createImageData(frame.dims.width, frame.dims.height);
		patchData.data.set(frame.patch);
		patchContext.putImageData(patchData, 0, 0);
		mainContext.drawImage(
			patchCanvas,
			Math.round(frame.dims.left * scale),
			Math.round(frame.dims.top * scale),
			Math.max(1, Math.round(frame.dims.width * scale)),
			Math.max(1, Math.round(frame.dims.height * scale)),
		);

		for (let panelIndex = 0; panelIndex < panelCanvases.length; panelIndex += 1) {
			const panelContext = panelContexts[panelIndex];
			if (!panelContext) continue;
			const sourceX = panelIndex === 0 ? 0 : mosaic.mainWidth;
			panelContext.clearRect(0, 0, panelCanvases[panelIndex].width, mosaic.height);
			panelContext.drawImage(mainCanvas, sourceX, 0, panelCanvases[panelIndex].width, mosaic.height, 0, 0, panelCanvases[panelIndex].width, mosaic.height);
			const pixels = panelContext.getImageData(0, 0, panelCanvases[panelIndex].width, mosaic.height).data;
			const { palette, indexed, transparentIndex } = indexFrame(pixels);
			encoders[panelIndex].writeFrame(indexed, panelCanvases[panelIndex].width, mosaic.height, {
				palette,
				delay: frame.delay || 100,
				...(frameIndex === 0 ? { repeat: 0 } : {}),
				transparent: transparentIndex >= 0,
				transparentIndex: Math.max(0, transparentIndex),
			});
		}

		previousFrame = frame;
		restorePrevious = restoreCurrent;
	}

	return Promise.all(encoders.map(async (encoder) => {
		encoder.finish();
		const encoded = encoder.bytes();
		const buffer = new ArrayBuffer(encoded.byteLength);
		new Uint8Array(buffer).set(encoded);
		return readBlobDataUrl(new Blob([buffer], { type: 'image/gif' }));
	}));
}

export default function ShowcaseEditor({ previewDocument, previewLevel, onPreviewLevelChange }: ShowcaseEditorProps) {
	const [entries, setEntries] = useState<ShowcaseEntry[]>([]);
	const [newShowcaseKind, setNewShowcaseKind] = useState<Exclude<ShowcaseKind, 'other'>>('artwork');
	const [error, setError] = useState('');

	useEffect(() => {
		const area = getShowcaseArea(previewDocument);
		if (!area) {
			setEntries([]);
			return;
		}

		const nextEntries = [...area.children]
			.filter((child) => child.classList.contains('profile_customization') && !child.classList.contains('customization_edit'))
			.map((child, index) => {
				const element = child as HTMLElement;
				const id = `showcase-${index}-${Math.random().toString(36).slice(2, 8)}`;
				element.dataset.steamcanvasShowcaseId = id;
				const title = element.querySelector<HTMLElement>('.profile_customization_header')?.textContent?.trim()
					|| 'Profile showcase';
				const artworkTitle = getArtworkTitle(element);
				return { id, kind: classifyShowcase(element), title, artworkTitle, artworkTitleHidden: isArtworkTitleHidden(artworkTitle), element };
			});
		setEntries(nextEntries);
		setError('');
	}, [previewDocument]);

	function syncOrder(nextEntries: ShowcaseEntry[]) {
		const area = getShowcaseArea(previewDocument);
		if (!area) return;
		const placeholder = [...area.children].find((child) => child.classList.contains('customization_edit')) || null;
		nextEntries.forEach((entry) => area.insertBefore(entry.element, placeholder));
		setEntries(nextEntries);
	}

	function moveShowcase(index: number, offset: -1 | 1) {
		const nextIndex = index + offset;
		if (nextIndex < 0 || nextIndex >= entries.length) return;
		const nextEntries = [...entries];
		[nextEntries[index], nextEntries[nextIndex]] = [nextEntries[nextIndex], nextEntries[index]];
		syncOrder(nextEntries);
	}

	function removeShowcase(entry: ShowcaseEntry) {
		entry.element.remove();
		setEntries((current) => current.filter((item) => item.id !== entry.id));
	}

	function addShowcase() {
		const area = getShowcaseArea(previewDocument, true);
		if (!area) return;
	const element = makeArtworkShowcase(globalThis.document, newShowcaseKind);
		const id = `showcase-new-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
		element.dataset.steamcanvasShowcaseId = id;
		const title = newShowcaseKind === 'featured-artwork' ? 'Featured Artwork Showcase' : 'Artwork Showcase';
		const entry: ShowcaseEntry = { id, kind: newShowcaseKind, title, artworkTitle: '', artworkTitleHidden: false, element };
		const placeholder = [...area.children].find((child) => child.classList.contains('customization_edit')) || null;
		area.insertBefore(element, placeholder);
		setEntries((current) => [...current, entry]);
		setError('');
	}

	async function updateArtwork(entry: ShowcaseEntry, event: ChangeEvent<HTMLInputElement>) {
		const files = [...(event.target.files || [])];
		event.target.value = '';
		if (!files.length) return;
		if (files.some((file) => !/^image\/(png|jpeg|webp|gif|avif|apng)$/.test(file.type))) {
			setError('Choose PNG, JPG, WEBP, GIF, APNG, or AVIF artwork.');
			return;
		}
		const images = [...entry.element.querySelectorAll<HTMLImageElement>('.screenshot_showcase_primary img, .screenshot_showcase_smallscreenshot img')];
		try {
			let exportWarning = false;
			const mosaic = entry.kind === 'artwork'
				? await splitArtworkMosaic(files[0])
				: { images: [await new Promise<string>((resolve, reject) => {
					const reader = new FileReader();
					reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Could not read artwork image.'));
					reader.onerror = () => reject(new Error('Could not read artwork image.'));
					reader.readAsDataURL(files[0]);
				})] };
			for (const [index, dataUrl] of mosaic.images.entries()) {
				const image = images[index];
				if (!image) break;
				image.src = dataUrl;
				image.style.height = mosaic.animated ? `${mosaic.animated.height}px` : 'auto';
				image.closest<HTMLElement>('[data-steamcanvas-empty-slot]')?.removeAttribute('data-steamcanvas-empty-slot');
				const anchor = image.closest<HTMLAnchorElement>('a');
				anchor?.setAttribute('href', dataUrl);
				if (mosaic.animated && anchor) {
					anchor.style.display = 'block';
					anchor.style.overflow = 'hidden';
					anchor.style.height = `${mosaic.animated.height}px`;
					anchor.style.width = index === 0 ? '100%' : '100px';
					image.style.width = `${mosaic.animated.width}px`;
					image.style.maxWidth = 'none';
					image.style.minHeight = '0';
					image.style.objectFit = 'fill';
					image.style.transform = index === 0 ? 'none' : `translateX(-${mosaic.animated.mainWidth}px)`;
					image.style.transformOrigin = 'top left';
				}
			}
			if (entry.kind === 'artwork') {
				const sideSlots = [...entry.element.querySelectorAll<HTMLElement>('.screenshot_showcase_smallscreenshot.showcase_slot')];
				sideSlots.slice(1).forEach((slot) => slot.remove());
				entry.element.dataset.steamcanvasMosaic = 'true';
				const baseName = files[0].name.replace(/\.[^.]+$/, '').replace(/[^\w.-]+/g, '-').slice(0, 80) || 'steam-artwork';
				if (mosaic.animated?.format === 'gif') {
					try {
						const gifPanels = await encodeAnimatedMosaic(files[0], mosaic.animated);
						setEntries((current) => current.map((item) => item.id !== entry.id ? item : {
							...item,
							exportFiles: [
								{ name: `${baseName}-main.gif`, url: gifPanels[0] },
								{ name: `${baseName}-side.gif`, url: gifPanels[1] },
							],
							animatedArtwork: undefined,
						}));
					} catch (caught) {
						const reason = caught instanceof Error ? caught.message : 'GIF export could not be completed.';
						setEntries((current) => current.map((item) => item.id !== entry.id ? item : {
							...item,
							exportFiles: undefined,
							animatedArtwork: { name: files[0].name, url: mosaic.images[0] },
						}));
						exportWarning = true;
						setError(`${reason} The original animated file is available to download.`);
					}
				} else if (mosaic.animated) {
					setEntries((current) => current.map((item) => item.id !== entry.id ? item : {
						...item,
						exportFiles: undefined,
						animatedArtwork: { name: files[0].name, url: mosaic.images[0] },
					}));
				} else {
					setEntries((current) => current.map((item) => item.id !== entry.id ? item : {
						...item,
						exportFiles: [
							{ name: `${baseName}-main.png`, url: mosaic.images[0] },
							{ name: `${baseName}-side.png`, url: mosaic.images[1] },
						],
						animatedArtwork: undefined,
					}));
				}
			}
			if (!exportWarning) setError('');
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : 'Could not load artwork images.');
		}
	}

	function updateArtworkTitle(entry: ShowcaseEntry, title: string) {
		const titleElement = entry.element.querySelector<HTMLElement>('.screenshot_showcase_itemname');
		if (titleElement) {
			titleElement.textContent = title;
			titleElement.style.visibility = title.trim() ? 'visible' : '';
		}
		setEntries((current) => current.map((item) => item.id === entry.id
			? { ...item, artworkTitle: title, artworkTitleHidden: isArtworkTitleHidden(title) }
			: item));
	}

	function toggleArtworkTitle(entry: ShowcaseEntry, hidden: boolean) {
		const titleElement = entry.element.querySelector<HTMLElement>('.screenshot_showcase_itemname');
		if (titleElement) {
			titleElement.style.visibility = hidden ? 'hidden' : '';
			if (hidden && !titleElement.textContent) titleElement.textContent = ' ';
		}
		setEntries((current) => current.map((item) => item.id === entry.id ? { ...item, artworkTitleHidden: hidden } : item));
	}

	return (
		<section className="showcase-editor" aria-labelledby="showcase-editor-title">
			<header className="showcase-editor-header">
				<div>
					<span className="source-label">PROFILE LAYOUT</span>
					<h2 id="showcase-editor-title">Showcases</h2>
				</div>
				<label className="showcase-level-control">
					<span>PREVIEW LVL</span>
					<input type="number" min="0" max="500" step="1" value={previewLevel} onChange={(event) => onPreviewLevelChange(Math.max(0, Math.min(500, Number(event.target.value) || 0)))} />
				</label>
			</header>
			<p className="showcase-capacity">{entries.length} in preview <span>·</span> {Math.floor(previewLevel / 10)} base slots at this level</p>

			<div className="showcase-add-row">
				<select aria-label="Showcase type to add" value={newShowcaseKind} onChange={(event) => setNewShowcaseKind(event.target.value as Exclude<ShowcaseKind, 'other'>)}>
					<option value="artwork">Artwork</option>
					<option value="featured-artwork">Featured artwork</option>
				</select>
				<button className="icon-button" type="button" title="Add showcase" aria-label="Add showcase" onClick={addShowcase} disabled={!previewDocument}>
					<Plus size={16} />
				</button>
			</div>

			{error && <p className="showcase-editor-error" role="alert">{error}</p>}
			{entries.length ? (
				<ol className="showcase-list">
					{entries.map((entry, index) => {
						const editableArtwork = entry.kind !== 'other';
						const imageCount = entry.element.querySelectorAll('.screenshot_showcase_primary img, .screenshot_showcase_smallscreenshot img').length;
						return (
							<li className="showcase-list-item" key={entry.id}>
								<div className="showcase-row">
									<div className="showcase-row-copy">
										<span className="showcase-order">{String(index + 1).padStart(2, '0')}</span>
										<span className="showcase-row-title" title={entry.title}>{entry.title}</span>
									</div>
									<div className="showcase-row-actions">
										{editableArtwork && (
											<label className="showcase-icon-action" title={entry.kind === 'artwork' ? 'Create a two-panel image mosaic' : 'Replace artwork image'}>
												<ImagePlus size={14} />
												<input className="visually-hidden" type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/apng,image/avif" onChange={(event) => void updateArtwork(entry, event)} />
											</label>
										)}
										<button className="showcase-icon-action" type="button" title="Move up" aria-label={`Move ${entry.title} up`} disabled={index === 0} onClick={() => moveShowcase(index, -1)}><ArrowUp size={14} /></button>
										<button className="showcase-icon-action" type="button" title="Move down" aria-label={`Move ${entry.title} down`} disabled={index === entries.length - 1} onClick={() => moveShowcase(index, 1)}><ArrowDown size={14} /></button>
										<button className="showcase-icon-action is-danger" type="button" title="Remove showcase" aria-label={`Remove ${entry.title}`} onClick={() => removeShowcase(entry)}><Trash2 size={14} /></button>
									</div>
								</div>
								{editableArtwork && (
									<>
									<div className="showcase-row-details">
										<span>{imageCount} {imageCount === 1 ? 'slot' : 'slots'}</span>
										<input aria-label="Artwork title" value={entry.artworkTitle.trim()} onChange={(event) => updateArtworkTitle(entry, event.target.value)} placeholder="Artwork title (optional)" />
									</div>
									<label className="showcase-title-visibility">
										<input type="checkbox" checked={entry.artworkTitleHidden} onChange={(event) => toggleArtworkTitle(entry, event.target.checked)} />
										Hide item title
									</label>
									{entry.exportFiles && (
										<div className="showcase-export-row" aria-label="Download mosaic panels">
											<span>Export mosaic</span>
											{entry.exportFiles.map((file) => (
												<a className="showcase-export-link" key={file.name} href={file.url} download={file.name} title={`Download ${file.name}`}>
													<Download size={13} /> {/\-main\.(png|gif)$/i.test(file.name) ? 'Main' : 'Side'}
												</a>
											))}
										</div>
									)}
									{entry.animatedArtwork && (
										<div className="showcase-export-row is-animated">
											<span>Animated mosaic is preview-only</span>
											<a className="showcase-export-link" href={entry.animatedArtwork.url} download={entry.animatedArtwork.name} title={`Download original ${entry.animatedArtwork.name}`}>
												<Download size={13} /> Original animation
											</a>
										</div>
									)}
									</>
								)}
							</li>
						);
					})}
				</ol>
			) : <p className="showcase-editor-empty">No profile showcases found.</p>}
		</section>
	);
}