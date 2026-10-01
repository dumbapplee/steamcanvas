import { useEffect, useState, type ChangeEvent, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { ArrowDown, ArrowUp, Download, ImagePlus, Pencil, Plus, Trash2 } from 'lucide-react';
import JSZip from 'jszip';
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
	host: HTMLElement;
};

type ShowcaseEditorProps = {
	previewDocument: Document | null;
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

function fitFeaturedImage(image: HTMLImageElement): void {
	image.style.display = 'block';
	image.style.width = '100%';
	image.style.maxWidth = '100%';
	image.style.height = 'auto';
	image.style.objectFit = 'contain';
}

function fitFeaturedArtwork(element: HTMLElement): void {
	element.querySelectorAll<HTMLImageElement>('.screenshot_showcase_primary.single img').forEach(fitFeaturedImage);
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

export default function ShowcaseEditor({ previewDocument }: ShowcaseEditorProps) {
	const [entries, setEntries] = useState<ShowcaseEntry[]>([]);
	const [newShowcaseKind, setNewShowcaseKind] = useState<Exclude<ShowcaseKind, 'other'>>('artwork');
	const [error, setError] = useState('');
	const [editingId, setEditingId] = useState<string | null>(null);
	const [addingOpen, setAddingOpen] = useState(false);
	const [addControlHost, setAddControlHost] = useState<HTMLElement | null>(null);

	function createOverlayHost(document: Document, parent: HTMLElement, name: string): HTMLElement {
		if (document.defaultView?.getComputedStyle(parent).position === 'static') parent.style.position = 'relative';
		const host = document.createElement('div');
		host.dataset.steamcanvasShowcaseControls = name;
		host.style.cssText = 'position:absolute;top:5px;right:5px;z-index:2147483000;display:block;pointer-events:auto;';
		parent.append(host);
		return host;
	}

	function createFixedAddHost(document: Document): HTMLElement {
		const host = document.createElement('div');
		host.dataset.steamcanvasShowcaseControls = 'add-showcase';
		host.style.cssText = 'position:fixed;top:0;left:50%;transform:translateX(-50%);z-index:2147483000;display:block;pointer-events:auto;';
		document.body.append(host);
		return host;
	}

	function positionFixedAddHost(host: HTMLElement, stage: HTMLElement): void {
		const view = stage.ownerDocument.defaultView;
		if (!view) return;

		const rect = stage.getBoundingClientRect();
		const visibleTop = Math.max(0, rect.top);
		const visibleBottom = Math.min(view.innerHeight, rect.bottom);
		const visibleLeft = Math.max(0, rect.left);
		const visibleRight = Math.min(view.innerWidth, rect.right);
		if (visibleBottom - visibleTop < 60 || visibleRight <= visibleLeft) {
			host.style.display = 'none';
			return;
		}

		host.style.display = 'block';
		host.style.left = `${(visibleLeft + visibleRight) / 2}px`;
		host.style.top = `${visibleBottom - 56}px`;
	}

	useEffect(() => {
		const area = getShowcaseArea(previewDocument, true);
		if (!area) {
			setEntries([]);
			setAddControlHost(null);
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
				const kind = classifyShowcase(element);
				const host = createOverlayHost(previewDocument!, element, id);
				if (kind === 'featured-artwork') fitFeaturedArtwork(element);
				return { id, kind, title, artworkTitle, artworkTitleHidden: isArtworkTitleHidden(artworkTitle), element, host };
			});
		setEntries(nextEntries);
		const previewStage = previewDocument!.defaultView?.frameElement?.closest<HTMLElement>('.preview-stage');
		const addHost = previewStage ? createFixedAddHost(previewStage.ownerDocument) : null;
		setAddControlHost(addHost);
		setEditingId(null);
		setAddingOpen(false);
		setError('');
		return () => {
			nextEntries.forEach((entry) => entry.host.remove());
			addHost?.remove();
		};
	}, [previewDocument]);

	useEffect(() => {
		if (!addControlHost || !previewDocument) return;
		const frameElement = previewDocument.defaultView?.frameElement;
		const stage = frameElement?.closest<HTMLElement>('.preview-stage');
		const view = stage?.ownerDocument.defaultView;
		if (!stage || !view) return;

		const updatePosition = () => positionFixedAddHost(addControlHost, stage);
		updatePosition();
		view.addEventListener('scroll', updatePosition, true);
		view.addEventListener('resize', updatePosition);
		return () => {
			view.removeEventListener('scroll', updatePosition, true);
			view.removeEventListener('resize', updatePosition);
		};
	}, [addControlHost, previewDocument]);

	useEffect(() => {
		if (!addingOpen || !addControlHost) return;
		const closeOnOutside = (event: Event) => {
			const target = event.target as Node | null;
			if (target && !addControlHost.contains(target)) setAddingOpen(false);
		};
		const closeOnEscape = (event: KeyboardEvent) => {
			if (event.key === 'Escape') setAddingOpen(false);
		};
		const documents = new Set([addControlHost.ownerDocument, previewDocument].filter((document): document is Document => !!document));
		documents.forEach((document) => {
			document.addEventListener('pointerdown', closeOnOutside, true);
			document.addEventListener('keydown', closeOnEscape, true);
		});
		return () => documents.forEach((document) => {
			document.removeEventListener('pointerdown', closeOnOutside, true);
			document.removeEventListener('keydown', closeOnEscape, true);
		});
	}, [addingOpen, addControlHost, previewDocument]);

	useEffect(() => {
		const activeEntry = entries.find((entry) => entry.id === editingId);
		if (!activeEntry || !previewDocument) return;
		const editRegion = activeEntry.host.querySelector<HTMLElement>('[data-showcase-edit-region]');
		const closeOnOutside = (event: Event) => {
			const target = event.target as Node | null;
			if (target && editRegion?.contains(target)) return;
			setEditingId(null);
		};
		const closeOnEscape = (event: KeyboardEvent) => {
			if (event.key === 'Escape') setEditingId(null);
		};
		const documents = new Set([activeEntry.host.ownerDocument, previewDocument]);
		documents.forEach((document) => {
			document.addEventListener('pointerdown', closeOnOutside, true);
			document.addEventListener('keydown', closeOnEscape, true);
		});
		return () => documents.forEach((document) => {
			document.removeEventListener('pointerdown', closeOnOutside, true);
			document.removeEventListener('keydown', closeOnEscape, true);
		});
	}, [editingId, entries, previewDocument]);

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
		const host = createOverlayHost(area.ownerDocument, element, id);
		const entry: ShowcaseEntry = { id, kind: newShowcaseKind, title, artworkTitle: '', artworkTitleHidden: false, element, host };
		const placeholder = [...area.children].find((child) => child.classList.contains('customization_edit')) || null;
		area.insertBefore(element, placeholder);
		const previewWindow = area.ownerDocument.defaultView;
		if (previewWindow) {
			const targetTop = element.getBoundingClientRect().top + previewWindow.scrollY - 24;
			previewWindow.scrollTo({ top: Math.max(0, targetTop), behavior: 'smooth' });
		}
		setEntries((current) => [...current, entry]);
		setAddingOpen(false);
		setEditingId(null);
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
				if (entry.kind === 'featured-artwork' && !mosaic.animated) fitFeaturedImage(image);
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

	async function downloadArtwork(entry: ShowcaseEntry) {
		if (entry.exportFiles?.length === 2) {
			try {
				const archive = new JSZip();
				for (const file of entry.exportFiles) {
					const response = await fetch(file.url);
					if (!response.ok) throw new Error(`Could not read ${file.name}.`);
					archive.file(file.name, await response.blob());
				}
				const blob = await archive.generateAsync({ type: 'blob' });
				const url = URL.createObjectURL(blob);
				const baseName = entry.exportFiles[0].name.replace(/-main\.(?:png|gif)$/i, '') || 'steam-artwork';
				const link = globalThis.document.createElement('a');
				link.href = url;
				link.download = `${baseName}.zip`;
				globalThis.document.body.append(link);
				link.click();
				link.remove();
				globalThis.setTimeout(() => URL.revokeObjectURL(url), 1000);
				return;
			} catch (caught) {
				setError(caught instanceof Error ? caught.message : 'Could not create the artwork ZIP.');
				setEditingId(entry.id);
				return;
			}
		}

		if (entry.animatedArtwork) {
			const link = globalThis.document.createElement('a');
			link.href = entry.animatedArtwork.url;
			link.download = entry.animatedArtwork.name;
			globalThis.document.body.append(link);
			link.click();
			link.remove();
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

	const buttonStyle: CSSProperties = {
		minHeight: '30px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '6px', padding: '0 9px',
		border: '1px solid rgba(220,225,228,.35)', borderRadius: '3px', background: 'rgba(18,25,31,.94)',
		color: '#f2f4f3', cursor: 'pointer', font: '12px Arial,sans-serif', whiteSpace: 'nowrap',
	};
	const popoverStyle: CSSProperties = {
		position: 'absolute', top: '36px', right: 0, width: '280px', padding: '14px', zIndex: 2147483000,
		border: '1px solid #76818a', borderRadius: '3px', background: '#202a32', color: '#e9eef0',
		boxShadow: '0 8px 24px rgba(0,0,0,.38)', font: '13px Arial,sans-serif', textAlign: 'left',
	};
	const fieldStyle: CSSProperties = {
		width: '100%', minWidth: 0, height: '29px', padding: '0 7px', boxSizing: 'border-box',
		border: '1px solid #65727b', background: '#11191f', color: '#f2f4f3', font: '12px Arial,sans-serif',
	};
	const floatingAddButtonStyle: CSSProperties = {
		minWidth: '154px', height: '44px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '9px', padding: '0 13px',
		cursor: 'pointer', font: '600 13px Arial,sans-serif', boxShadow: '0 4px 14px rgba(0,0,0,.42)',
	};
	const addPopoverStyle: CSSProperties = {
		...popoverStyle, top: 'auto', bottom: '50px', left: '50%', right: 'auto', transform: 'translateX(-50%)',
	};
	const renderOverlay = (entry: ShowcaseEntry, index: number, host: HTMLElement) => createPortal(
		<div style={{ position: 'relative', display: 'flex', justifyContent: 'flex-end', gap: '6px', padding: '3px', borderRadius: '4px', background: 'rgba(12,17,21,.72)', backdropFilter: 'blur(4px)' }}>
			<div data-showcase-edit-region="true" style={{ position: 'relative' }}>
				<button type="button" style={buttonStyle} title={`Edit ${entry.title}`} aria-label={`Edit ${entry.title}`} onClick={() => { setEditingId((id) => id === entry.id ? null : entry.id); setAddingOpen(false); }}><Pencil size={14} />Edit</button>
				{editingId === entry.id && <div style={popoverStyle} onClick={(event) => event.stopPropagation()}>
				<div style={{ marginBottom: '10px', color: '#e9eef0', fontSize: '14px', fontWeight: 700 }}>{entry.title}</div>
				<div style={{ display: 'flex', gap: '6px', marginBottom: entry.kind === 'other' ? 0 : '13px' }}>
					<button type="button" style={{ ...buttonStyle, flex: 1 }} disabled={index === 0} onClick={() => moveShowcase(index, -1)}><ArrowUp size={14} />Move up</button>
					<button type="button" style={{ ...buttonStyle, flex: 1 }} disabled={index === entries.length - 1} onClick={() => moveShowcase(index, 1)}><ArrowDown size={14} />Move down</button>
					<button type="button" style={{ ...buttonStyle, color: '#ffc0b5' }} onClick={() => removeShowcase(entry)}><Trash2 size={14} />Remove</button>
				</div>
				{entry.kind !== 'other' && <>
				<label style={{ display: 'grid', gap: '5px', marginBottom: '10px' }}><span>Artwork title</span><input style={fieldStyle} aria-label={`Artwork title for ${entry.title}`} value={entry.artworkTitle.trim()} onChange={(event) => updateArtworkTitle(entry, event.target.value)} placeholder="Optional" /></label>
				<label style={{ display: 'flex', alignItems: 'center', gap: '7px', marginBottom: '11px', cursor: 'pointer' }}><input type="checkbox" checked={entry.artworkTitleHidden} onChange={(event) => toggleArtworkTitle(entry, event.target.checked)} />Hide item title</label>
				<label style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', minHeight: '34px', marginBottom: '9px', border: '1px solid #65727b', background: '#303c44', cursor: 'pointer' }}><ImagePlus size={14} />Replace artwork<input type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/apng,image/avif" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0, cursor: 'pointer' }} onChange={(event) => void updateArtwork(entry, event)} /></label>
				</>}
				{error && <div role="alert" style={{ marginTop: '7px', color: '#ffb8ad' }}>{error}</div>}
				</div>}
			</div>
			{entry.kind === 'artwork' && (entry.exportFiles?.length === 2 || entry.animatedArtwork) && <button type="button" style={buttonStyle} title={entry.exportFiles?.length === 2 ? 'Download main and side as ZIP' : 'Download original animation'} aria-label={`${entry.exportFiles?.length === 2 ? 'Download ZIP' : 'Download original'} for ${entry.title}`} onClick={() => void downloadArtwork(entry)}><Download size={14} />{entry.exportFiles?.length === 2 ? 'Download ZIP' : 'Download original'}</button>}
		</div>, host, entry?.id || 'showcase-add-controls');
	const renderAddControl = (host: HTMLElement) => createPortal(
		<div style={{ position: 'relative' }}>
			<button type="button" className="showcase-add-trigger" style={floatingAddButtonStyle} title="Add showcase" aria-label="Add showcase" onClick={() => { setAddingOpen((open) => !open); setEditingId(null); }}><Plus size={18} color="#ffffff" />Add showcase</button>
			{addingOpen && <div style={addPopoverStyle} onClick={(event) => event.stopPropagation()}>
				<div style={{ marginBottom: '10px', color: '#e9eef0', fontSize: '14px', fontWeight: 700 }}>Add a showcase</div>
				<label style={{ display: 'grid', gap: '5px', marginBottom: '10px' }}><span>Showcase type</span><select style={fieldStyle} value={newShowcaseKind} onChange={(event) => setNewShowcaseKind(event.target.value as Exclude<ShowcaseKind, 'other'>)}><option value="artwork">Artwork</option><option value="featured-artwork">Featured artwork</option></select></label>
				<button type="button" style={{ ...buttonStyle, width: '100%', marginTop: '2px', background: '#52752a', borderColor: '#789c42', color: '#ffffff' }} onClick={addShowcase}><Plus size={14} color="#ffffff" />Add</button>
				{error && <div role="alert" style={{ marginTop: '7px', color: '#ffb8ad' }}>{error}</div>}
			</div>}
		</div>, host, 'showcase-add-controls');

	if (!previewDocument) return null;
	return <>
		{entries.map((entry, index) => renderOverlay(entry, index, entry.host))}
		{addControlHost && renderAddControl(addControlHost)}
	</>;
}