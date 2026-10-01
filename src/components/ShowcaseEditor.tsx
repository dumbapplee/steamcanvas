import { useEffect, useRef, useState, type ChangeEvent, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, Download, ImagePlus, Pencil, Plus, Search, Trash2, X } from 'lucide-react';
import JSZip from 'jszip';
import { decompressFrames, parseGIF, type ParsedFrame } from 'gifuct-js';
import { applyPalette, GIFEncoder, quantize } from 'gifenc';

type ShowcaseKind = 'artwork' | 'featured-artwork' | 'screenshot' | 'workshop' | 'other';
type CreatableShowcaseKind = 'artwork' | 'featured-artwork' | 'screenshot' | 'workshop';

type ShowcaseEntry = {
	id: string;
	kind: ShowcaseKind;
	title: string;
	exportFiles?: Array<{ name: string; url: string }>;
	animatedArtwork?: { name: string; url: string };
	element: HTMLElement;
	host: HTMLElement;
};

type PublicScreenshot = { id: string; imageUrl: string; thumbnailUrl: string; fullImageUrl?: string; steamUrl: string; appid?: number; aspectRatio?: number };
type EditorSource = File | PublicScreenshot;

type ShowcaseEditorProps = {
	previewDocument: Document | null;
	profileUrl: string;
};

type ArtworkMosaic = {
	images: string[];
	previewImages?: string[];
	panelDimensions?: Array<{ width: number; height: number }>;
	animated?: { width: number; height: number; mainWidth: number; panelWidths?: number[]; panelRegions?: Array<{ x: number; y: number; width: number; height: number }>; format: 'gif' | 'apng' };
};

type PreviewPanel = { src: string; width: number; height: number };

type ShowcasePointerGesture = {
	id: string;
	pointerId: number;
	x: number;
	y: number;
	offsetX: number;
	offsetY: number;
	moved: boolean;
	element: HTMLElement;
	placeholder: HTMLElement | null;
	ghost: HTMLElement | null;
	originalDisplay: string;
	originalUserSelect: string;
};

type ImageInputMode = 'composite' | 'separate' | 'public';
type ArtworkLayout = 'main-side' | 'main-three-side';

function readImageFile(file: File): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Could not read image.'));
		reader.onerror = () => reject(new Error('Could not read image.'));
		reader.readAsDataURL(file);
	});
}

function getImageExtension(file: File): string {
	const extension = file.name.match(/\.(png|jpe?g|webp|gif|apng|avif)$/i)?.[1]?.toLowerCase();
	return extension === 'jpeg' ? 'jpg' : extension || (file.type === 'image/gif' ? 'gif' : 'png');
}

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
	if (element.querySelector('.myworkshop_showcase')) return 'workshop';
	if (element.classList.contains('myscreenshots')) return 'screenshot';
	if (!element.classList.contains('myart')) return 'other';
	return element.querySelector('.screenshot_showcase_primary.single') ? 'featured-artwork' : 'artwork';
}

function hasTwoPanelImageEditor(kind: ShowcaseKind): boolean {
	return kind === 'artwork' || kind === 'screenshot';
}

function getMosaicPanelCount(kind: ShowcaseKind, layout: ArtworkLayout): number {
	return kind === 'workshop' ? 5 : hasTwoPanelImageEditor(kind) ? layout === 'main-three-side' ? 4 : 2 : 1;
}

function getExportPanelCount(entry: ShowcaseEntry): number {
	if (entry.kind === 'workshop') return 5;
	if (hasTwoPanelImageEditor(entry.kind) && entry.element.dataset.steamcanvasMosaicPanels === '4') return 4;
	return hasTwoPanelImageEditor(entry.kind) ? 2 : 0;
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

function makeArtworkShowcase(document: Document, kind: 'artwork' | 'featured-artwork'): HTMLElement {
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

function makeScreenshotShowcase(document: Document): HTMLElement {
	const showcase = document.createElement('div');
	showcase.className = 'profile_customization myscreenshots';
	showcase.dataset.steamcanvasNewShowcase = 'true';

	const header = document.createElement('div');
	header.className = 'profile_customization_header';
	header.textContent = 'Screenshot Showcase';
	const block = document.createElement('div');
	block.className = 'profile_customization_block';
	const content = document.createElement('div');
	content.className = 'screenshot_showcase';

	const primary = makeImageSlot(document, 'screenshot_showcase_primary showcase_slot', 506);
	const title = document.createElement('div');
	title.className = 'screenshot_showcase_itemname';
	const stats = document.createElement('div');
	stats.className = 'screenshot_showcase_stats';
	primary.append(title, stats);
	content.append(primary);

	const right = document.createElement('div');
	right.className = 'screenshot_showcase_rightcol';
	for (let index = 0; index < 3; index += 1) {
		right.append(makeImageSlot(document, 'screenshot_showcase_smallscreenshot showcase_slot', 100));
	}
	const screenshotCount = document.createElement('a');
	screenshotCount.className = 'screenshot_showcase_smallscreenshot screenshot_count';
	screenshotCount.href = '#';
	const countLabel = document.createElement('div');
	countLabel.className = 'screenshot_showcase_screenshot';
	countLabel.textContent = '+ 0';
	screenshotCount.append(countLabel);
	right.append(screenshotCount);
	content.append(right);

	const clear = document.createElement('div');
	clear.style.clear = 'both';
	content.append(clear);
	block.append(content);
	showcase.append(header, block);
	return showcase;
}

function makeWorkshopShowcase(document: Document): HTMLElement {
	const showcase = document.createElement('div');
	showcase.className = 'profile_customization';
	showcase.dataset.steamcanvasNewShowcase = 'true';

	const header = document.createElement('div');
	header.className = 'profile_customization_header';
	header.textContent = 'Workshop Showcase';
	const ownerHeader = document.createElement('div');
	ownerHeader.className = 'myworkshop_showcase_header';
	const avatar = document.createElement('div');
	avatar.className = 'playerAvatar offline';
	const avatarLink = document.createElement('a');
	avatarLink.href = '#';
	const avatarImage = document.createElement('img');
	avatarImage.src = document.querySelector<HTMLImageElement>('.playerAvatarAutoSizeInner > picture img')?.src || '';
	avatarImage.alt = '';
	avatarLink.append(avatarImage);
	avatar.append(avatarLink);
	const ownerName = document.createElement('a');
	ownerName.className = 'myworkshop_playerName';
	ownerName.href = '#';
	ownerName.textContent = `${document.querySelector<HTMLElement>('.actual_persona_name')?.textContent?.trim() || 'Steam user'}'s Workshop`;
	ownerHeader.append(avatar, ownerName);
	const block = document.createElement('div');
	block.className = 'profile_customization_block';
	const content = document.createElement('div');
	content.className = 'myworkshop_showcase';

	for (let index = 0; index < 5; index += 1) {
		const slot = document.createElement('div');
		slot.className = 'workshop_showcase_mutiitem_ctn';
		slot.dataset.steamcanvasEmptySlot = 'true';
		const innerSlot = document.createElement('div');
		innerSlot.className = 'workshop_showcase_multiitem showcase_slot';
		const anchor = document.createElement('a');
		anchor.className = 'ugc';
		anchor.href = '#';
		const image = document.createElement('img');
		image.className = 'workshop_showcase_item_image';
		image.alt = '';
		image.src = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="126" height="84" viewBox="0 0 126 84"><rect width="126" height="84" fill="#344b5b"/></svg>')}`;
		anchor.append(image);
		innerSlot.append(anchor);
		slot.append(innerSlot);
		content.append(slot);
	}

	const clear = document.createElement('div');
	clear.style.clear = 'left';
	const stats = document.createElement('div');
	stats.className = 'showcase_stats_row showcase_content_bg';
	for (const label of ['Submissions', 'Followers']) {
		const stat = document.createElement(label === 'Submissions' ? 'a' : 'div');
		stat.className = 'showcase_stat';
		if (label === 'Submissions') stat.setAttribute('href', '#');
		const value = document.createElement('div');
		value.className = 'value';
		value.textContent = '0';
		const statLabel = document.createElement('div');
		statLabel.className = 'label';
		statLabel.textContent = label;
		stat.append(value, statLabel);
		stats.append(stat);
	}
	content.append(clear, stats);
	block.append(content);
	showcase.append(header, ownerHeader, block);
	return showcase;
}

async function splitArtworkMosaic(file: File, layout: ArtworkLayout = 'main-side'): Promise<ArtworkMosaic> {
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
	const sideCount = layout === 'main-three-side' ? 3 : 1;
	const sideHeightEdges = Array.from({ length: sideCount + 1 }, (_, index) => Math.floor(index * compositeHeight / sideCount));
	const panelRegions = [
		{ x: 0, y: 0, width: outputMainWidth, height: compositeHeight },
		...Array.from({ length: sideCount }, (_, index) => ({
			x: outputMainWidth,
			y: sideHeightEdges[index],
			width: sideWidth,
			height: Math.max(1, sideHeightEdges[index + 1] - sideHeightEdges[index]),
		})),
	];
	if (file.type === 'image/gif' || file.type === 'image/apng' || /\.(gif|apng)$/i.test(file.name)) {
		return {
			images: Array(panelRegions.length).fill(dataUrl),
			previewImages: cropImagePreview(image, compositeWidth, compositeHeight, panelRegions),
			panelDimensions: panelRegions.map(({ width, height }) => ({ width, height })),
			animated: {
				width: compositeWidth,
				height: compositeHeight,
				mainWidth: outputMainWidth,
				panelRegions,
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

	const extractTile = ({ x, y, width, height }: typeof panelRegions[number]) => {
		const tile = document.createElement('canvas');
		tile.width = width;
		tile.height = height;
		const tileContext = tile.getContext('2d');
		if (!tileContext) throw new Error('Could not prepare an artwork tile.');
		tileContext.drawImage(composite, x, y, width, height, 0, 0, width, height);
		return tile.toDataURL('image/png');
	};

	return {
		images: panelRegions.map(extractTile),
		panelDimensions: panelRegions.map(({ width, height }) => ({ width, height })),
	};
}

async function splitWorkshopMosaic(file: File): Promise<ArtworkMosaic> {
	const dataUrl = await new Promise<string>((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Could not read workshop image.'));
		reader.onerror = () => reject(new Error('Could not read workshop image.'));
		reader.readAsDataURL(file);
	});
	const image = new Image();
	image.src = dataUrl;
	await image.decode();

	const panelCount = 5;
	const width = 630;
	const height = Math.max(1, Math.round(image.naturalHeight * width / image.naturalWidth));
	const panelWidths = Array.from({ length: panelCount }, (_, index) => Math.floor((index + 1) * width / panelCount) - Math.floor(index * width / panelCount));
	const isGif = file.type === 'image/gif' || /\.gif$/i.test(file.name);
	const isApng = file.type === 'image/apng' || /\.apng$/i.test(file.name);
	if (isGif || isApng) {
		const panelRegions = panelWidths.map((panelWidth, index) => ({ x: panelWidths.slice(0, index).reduce((sum, size) => sum + size, 0), y: 0, width: panelWidth, height }));
		return { images: Array(panelCount).fill(dataUrl), previewImages: cropImagePreview(image, width, height, panelRegions), panelDimensions: panelWidths.map((panelWidth) => ({ width: panelWidth, height })), animated: { width, height, mainWidth: panelWidths[0], panelWidths, format: isGif ? 'gif' : 'apng' } };
	}

	const canvas = document.createElement('canvas');
	canvas.width = width;
	canvas.height = height;
	const context = canvas.getContext('2d');
	if (!context) throw new Error('Could not prepare workshop image panels.');
	context.drawImage(image, 0, 0, width, height);

	const panels: string[] = [];
	let sourceX = 0;
	for (const panelWidth of panelWidths) {
		const panel = document.createElement('canvas');
		panel.width = panelWidth;
		panel.height = height;
		const panelContext = panel.getContext('2d');
		if (!panelContext) throw new Error('Could not prepare a workshop image panel.');
		panelContext.drawImage(canvas, sourceX, 0, panelWidth, height, 0, 0, panelWidth, height);
		panels.push(panel.toDataURL('image/png'));
		sourceX += panelWidth;
	}
	return { images: panels, panelDimensions: panelWidths.map((panelWidth) => ({ width: panelWidth, height })) };
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

	const panelRegions = mosaic.panelRegions || (mosaic.panelWidths || [mosaic.mainWidth, mosaic.width - mosaic.mainWidth]).map((width, index, widths) => ({
		x: widths.slice(0, index).reduce((total, value) => total + value, 0), y: 0, width, height: mosaic.height,
	}));
	const encoders = panelRegions.map((region) => GIFEncoder({ initialCapacity: Math.max(4096, region.width * region.height) }));
	const panelCanvases = panelRegions.map((region) => {
		const canvas = document.createElement('canvas');
		canvas.width = region.width;
		canvas.height = region.height;
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
			const region = panelRegions[panelIndex];
			panelContext.clearRect(0, 0, region.width, region.height);
			panelContext.drawImage(mainCanvas, region.x, region.y, region.width, region.height, 0, 0, region.width, region.height);
			const pixels = panelContext.getImageData(0, 0, region.width, region.height).data;
			const { palette, indexed, transparentIndex } = indexFrame(pixels);
			encoders[panelIndex].writeFrame(indexed, region.width, region.height, {
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

function isPublicScreenshot(source: EditorSource): source is PublicScreenshot {
	return 'imageUrl' in source;
}

function sourceName(source: EditorSource): string {
	return isPublicScreenshot(source) ? `Screenshot ${source.id}` : source.name;
}

export default function ShowcaseEditor({ previewDocument, profileUrl }: ShowcaseEditorProps) {
	const [entries, setEntries] = useState<ShowcaseEntry[]>([]);
	const [newShowcaseKind, setNewShowcaseKind] = useState<CreatableShowcaseKind>('artwork');
	const [error, setError] = useState('');
	const [editingId, setEditingId] = useState<string | null>(null);
	const [imageInputMode, setImageInputMode] = useState<ImageInputMode>('composite');
	const [artworkLayout, setArtworkLayout] = useState<ArtworkLayout>('main-side');
	const [editorFiles, setEditorFiles] = useState<Array<EditorSource | null>>([]);
	const [editorPreview, setEditorPreview] = useState<Array<PreviewPanel | null>>([]);
	const [editorLoading, setEditorLoading] = useState(false);
	const [editorError, setEditorError] = useState('');
	const [publicScreenshots, setPublicScreenshots] = useState<PublicScreenshot[]>([]);
	const [publicScreenshotSearch, setPublicScreenshotSearch] = useState('');
	const [publicScreenshotPage, setPublicScreenshotPage] = useState(0);
	const [publicScreenshotExpanded, setPublicScreenshotExpanded] = useState(false);
	const [publicScreenshotsLoading, setPublicScreenshotsLoading] = useState(false);
	const [publicScreenshotNextPage, setPublicScreenshotNextPage] = useState(1);
	const [publicScreenshotHasMore, setPublicScreenshotHasMore] = useState(true);
	const [addingOpen, setAddingOpen] = useState(false);
	const [addControlHost, setAddControlHost] = useState<HTMLElement | null>(null);
	const [draggingShowcaseId, setDraggingShowcaseId] = useState<string | null>(null);
	const [dragTargetShowcaseId, setDragTargetShowcaseId] = useState<string | null>(null);
	const [hoveredShowcaseId, setHoveredShowcaseId] = useState<string | null>(null);
	const editorDialogRef = useRef<HTMLDialogElement>(null);
	const previewRequestId = useRef(0);
	const dragTargetRef = useRef<{ id: string | null; after: boolean }>({ id: null, after: false });
	const pointerGestureRef = useRef<ShowcasePointerGesture | null>(null);
	const suppressClickRef = useRef(false);

	function createOverlayHost(document: Document, parent: HTMLElement, name: string): HTMLElement {
		if (document.defaultView?.getComputedStyle(parent).position === 'static') parent.style.position = 'relative';
		const host = document.createElement('div');
		host.dataset.steamcanvasShowcaseControls = name;
		host.style.cssText = 'position:absolute;inset:0;z-index:2147483000;display:block;pointer-events:none;';
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
		const dragStyle = previewDocument!.createElement('style');
		dragStyle.dataset.steamcanvasDragCursor = 'true';
		dragStyle.textContent = '[data-steamcanvas-draggable="true"]:hover,[data-steamcanvas-draggable="true"]:hover *{cursor:grab!important}[data-steamcanvas-draggable="true"][data-steamcanvas-dragging="true"],[data-steamcanvas-draggable="true"][data-steamcanvas-dragging="true"] *{cursor:grabbing!important}[data-steamcanvas-draggable="true"]:hover [data-steamcanvas-showcase-controls],[data-steamcanvas-draggable="true"]:hover [data-steamcanvas-showcase-controls] *{cursor:pointer!important}';
		previewDocument!.head.append(dragStyle);

		const nextEntries = [...area.children]
			.filter((child) => child.classList.contains('profile_customization') && !child.classList.contains('customization_edit'))
			.map((child, index) => {
				const element = child as HTMLElement;
				const id = `showcase-${index}-${Math.random().toString(36).slice(2, 8)}`;
				element.dataset.steamcanvasShowcaseId = id;
				const title = element.querySelector<HTMLElement>('.profile_customization_header')?.textContent?.trim()
					|| 'Profile showcase';
				const kind = classifyShowcase(element);
				element.dataset.steamcanvasDraggable = 'true';
				const host = createOverlayHost(previewDocument!, element, id);
				if (kind === 'featured-artwork') fitFeaturedArtwork(element);
				return { id, kind, title, element, host };
			});
		setEntries(nextEntries);
		const previewStage = previewDocument!.defaultView?.frameElement?.closest<HTMLElement>('.preview-stage');
		const addHost = previewStage ? createFixedAddHost(previewStage.ownerDocument) : null;
		setAddControlHost(addHost);
		setEditingId(null);
		setAddingOpen(false);
		setError('');
		return () => {
			nextEntries.forEach((entry) => {
				entry.host.remove();
				delete entry.element.dataset.steamcanvasDraggable;
				delete entry.element.dataset.steamcanvasDragging;
			});
			dragStyle.remove();
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
		const dialog = editorDialogRef.current;
		if (!dialog) return;
		if (editingId && !dialog.open) dialog.showModal();
		if (!editingId && dialog.open) dialog.close();
	}, [editingId]);

	useEffect(() => {
		if (!previewDocument) return;
		const finishGesture = (gesture: ShowcasePointerGesture, commit: boolean) => {
			const { element, placeholder, ghost, originalDisplay, originalUserSelect } = gesture;
			if (commit && gesture.moved) {
				element.style.display = originalDisplay;
				placeholder?.remove();
				dropShowcaseOn(dragTargetRef.current.id, dragTargetRef.current.after, gesture.id);
			} else {
				placeholder?.remove();
				element.style.display = originalDisplay;
			}
			ghost?.remove();
			delete element.dataset.steamcanvasDragging;
			previewDocument.documentElement.style.userSelect = originalUserSelect;
			if (gesture.moved) globalThis.setTimeout(() => { suppressClickRef.current = false; }, 500);
			pointerGestureRef.current = null;
			dragTargetRef.current = { id: null, after: false };
			setDraggingShowcaseId(null);
			setDragTargetShowcaseId(null);
		};
		const onPointerMove = (event: PointerEvent) => {
			const gesture = pointerGestureRef.current;
			if (!gesture || gesture.pointerId !== event.pointerId) return;
			if (!gesture.moved && Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) < 7) return;
			if (!gesture.moved) {
				gesture.moved = true;
				suppressClickRef.current = true;
				gesture.element.dataset.steamcanvasDragging = 'true';
				const rect = gesture.element.getBoundingClientRect();
				const computed = previewDocument.defaultView?.getComputedStyle(gesture.element);
				const placeholder = previewDocument.createElement('div');
				placeholder.className = gesture.element.className;
				placeholder.dataset.steamcanvasDragPlaceholder = 'true';
				placeholder.setAttribute('aria-hidden', 'true');
				placeholder.style.cssText = `box-sizing:border-box;width:${rect.width}px;height:${rect.height}px;min-height:${rect.height}px;margin:${computed?.margin || '0'};border:1px dashed rgba(126,155,61,.72);border-radius:3px;background:rgba(196,243,106,.12);transition:transform .16s ease,margin .16s ease;`;
				gesture.element.parentElement?.insertBefore(placeholder, gesture.element);
				gesture.placeholder = placeholder;
				const ghost = gesture.element.cloneNode(true) as HTMLElement;
				ghost.querySelectorAll('[data-steamcanvas-showcase-controls]').forEach((control) => control.remove());
				ghost.querySelectorAll('img').forEach((image) => { image.draggable = false; });
				ghost.style.cssText += `;position:fixed!important;left:${rect.left}px!important;top:${rect.top}px!important;width:${rect.width}px!important;height:${rect.height}px!important;margin:0!important;z-index:2147483647!important;opacity:.94!important;pointer-events:none!important;transform:scale(1.025)!important;transform-origin:center!important;box-shadow:0 20px 48px rgba(0,0,0,.42)!important;transition:box-shadow .14s ease,transform .14s ease!important;`;
				previewDocument.body.append(ghost);
				gesture.ghost = ghost;
				gesture.element.style.display = 'none';
				previewDocument.documentElement.style.userSelect = 'none';
				setDraggingShowcaseId(gesture.id);
			}
			if (gesture.ghost) {
				gesture.ghost.style.left = `${event.clientX - gesture.offsetX}px`;
				gesture.ghost.style.top = `${event.clientY - gesture.offsetY}px`;
			}
			const nearest = entries
				.filter((entry) => entry.id !== gesture.id)
				.map((entry) => ({ entry, rect: entry.element.getBoundingClientRect() }))
				.sort((left, right) => Math.abs(left.rect.top + left.rect.height / 2 - event.clientY) - Math.abs(right.rect.top + right.rect.height / 2 - event.clientY))[0];
			const id = nearest?.entry.id || null;
			const after = nearest ? event.clientY >= nearest.rect.top + nearest.rect.height / 2 : false;
			dragTargetRef.current = { id, after };
			setDragTargetShowcaseId(id);
			if (nearest && gesture.placeholder) {
				const parent = nearest.entry.element.parentElement;
				const reference = after ? nearest.entry.element.nextSibling : nearest.entry.element;
				if (parent && reference !== gesture.placeholder) {
					const previousTops = new Map(entries.filter((entry) => entry.id !== gesture.id).map((entry) => [entry.element, entry.element.getBoundingClientRect().top]));
					parent.insertBefore(gesture.placeholder, reference);
					for (const [element, previousTop] of previousTops) {
						const deltaY = previousTop - element.getBoundingClientRect().top;
						if (Math.abs(deltaY) < 1) continue;
						element.getAnimations().forEach((animation) => animation.cancel());
						element.animate([{ transform: `translateY(${deltaY}px)` }, { transform: 'translateY(0)' }], { duration: 190, easing: 'cubic-bezier(.2,.75,.25,1)' });
					}
				}
			}
			event.preventDefault();
		};
		const onPointerUp = (event: PointerEvent) => {
			const gesture = pointerGestureRef.current;
			if (!gesture || gesture.pointerId !== event.pointerId) return;
			finishGesture(gesture, true);
		};
		const onPointerCancel = (event: PointerEvent) => {
			const gesture = pointerGestureRef.current;
			if (gesture?.pointerId === event.pointerId) finishGesture(gesture, false);
		};
		const onClick = (event: MouseEvent) => {
			if (!suppressClickRef.current) return;
			suppressClickRef.current = false;
			event.preventDefault();
			event.stopPropagation();
		};
		const handlers = entries.map((entry) => {
			const onPointerDown = (event: PointerEvent) => {
				if (event.button !== 0 || (event.target as Element | null)?.closest('[data-steamcanvas-showcase-controls]')) return;
				try {
					entry.element.setPointerCapture(event.pointerId);
				} catch {}
				const originalUserSelect = previewDocument.documentElement.style.userSelect;
				previewDocument.documentElement.style.userSelect = 'none';
				const rect = entry.element.getBoundingClientRect();
				pointerGestureRef.current = {
					id: entry.id,
					pointerId: event.pointerId,
					x: event.clientX,
					y: event.clientY,
					offsetX: event.clientX - rect.left,
					offsetY: event.clientY - rect.top,
					moved: false,
					element: entry.element,
					placeholder: null,
					ghost: null,
					originalDisplay: entry.element.style.display,
					originalUserSelect,
				};
				setHoveredShowcaseId(entry.id);
			};
			const onDragStart = (event: DragEvent) => event.preventDefault();
			const onEnter = () => setHoveredShowcaseId(entry.id);
			const onLeave = () => setHoveredShowcaseId((current) => current === entry.id ? null : current);
			entry.element.addEventListener('pointerdown', onPointerDown);
			entry.element.addEventListener('dragstart', onDragStart);
			entry.element.addEventListener('mouseenter', onEnter);
			entry.element.addEventListener('mouseleave', onLeave);
			return () => {
				entry.element.removeEventListener('pointerdown', onPointerDown);
				entry.element.removeEventListener('dragstart', onDragStart);
				entry.element.removeEventListener('mouseenter', onEnter);
				entry.element.removeEventListener('mouseleave', onLeave);
			};
		});
		previewDocument.addEventListener('pointermove', onPointerMove, true);
		previewDocument.addEventListener('pointerup', onPointerUp, true);
		previewDocument.addEventListener('pointercancel', onPointerCancel, true);
		previewDocument.addEventListener('click', onClick, true);
		return () => {
			handlers.forEach((cleanup) => cleanup());
			previewDocument.removeEventListener('pointermove', onPointerMove, true);
			previewDocument.removeEventListener('pointerup', onPointerUp, true);
			previewDocument.removeEventListener('pointercancel', onPointerCancel, true);
			previewDocument.removeEventListener('click', onClick, true);
		};
	}, [entries, previewDocument]);

	function syncOrder(nextEntries: ShowcaseEntry[]) {
		const area = getShowcaseArea(previewDocument);
		if (!area) return;
		const placeholder = [...area.children].find((child) => child.classList.contains('customization_edit')) || null;
		nextEntries.forEach((entry) => area.insertBefore(entry.element, placeholder));
		setEntries(nextEntries);
	}

	function dropShowcaseOn(targetId: string | null, after = false, sourceId = draggingShowcaseId) {
		if (!targetId) return;
		if (!sourceId || sourceId === targetId) return;
		const nextEntries = [...entries];
		const fromIndex = nextEntries.findIndex((entry) => entry.id === sourceId);
		const toIndex = nextEntries.findIndex((entry) => entry.id === targetId);
		if (fromIndex < 0 || toIndex < 0) return;
		const [moved] = nextEntries.splice(fromIndex, 1);
		const targetIndex = toIndex - (fromIndex < toIndex ? 1 : 0);
		nextEntries.splice(targetIndex + (after ? 1 : 0), 0, moved);
		syncOrder(nextEntries);
		setDraggingShowcaseId(null);
		setDragTargetShowcaseId(null);
	}

	function removeShowcase(entry: ShowcaseEntry) {
		entry.element.remove();
		setEntries((current) => current.filter((item) => item.id !== entry.id));
	}

	function addShowcase() {
		const area = getShowcaseArea(previewDocument, true);
		if (!area) {
			setError('Showcase area not found.');
			return;
		}
		const element = newShowcaseKind === 'workshop'
			? makeWorkshopShowcase(area.ownerDocument)
			: newShowcaseKind === 'screenshot'
				? makeScreenshotShowcase(area.ownerDocument)
				: makeArtworkShowcase(area.ownerDocument, newShowcaseKind);
		const id = `showcase-new-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
		element.dataset.steamcanvasShowcaseId = id;
		const title = newShowcaseKind === 'workshop'
			? 'Workshop Showcase'
			: newShowcaseKind === 'screenshot'
				? 'Screenshot Showcase'
				: newShowcaseKind === 'featured-artwork' ? 'Featured Artwork Showcase' : 'Artwork Showcase';
		element.dataset.steamcanvasDraggable = 'true';
		const host = createOverlayHost(area.ownerDocument, element, id);
		const entry: ShowcaseEntry = { id, kind: newShowcaseKind, title, element, host };
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

	const activeEditor = entries.find((entry) => entry.id === editingId) || null;
	const editorPanelCount = activeEditor ? getMosaicPanelCount(activeEditor.kind, artworkLayout) : 1;

	function openEditor(entry: ShowcaseEntry) {
		const savedLayout = entry.element.dataset.steamcanvasMosaicPanels === '4' ? 'main-three-side' : 'main-side';
		setArtworkLayout(savedLayout);
		const panelCount = getMosaicPanelCount(entry.kind, savedLayout);
		const currentImages = [...entry.element.querySelectorAll<HTMLImageElement>(entry.kind === 'workshop'
			? '.myworkshop_showcase .workshop_showcase_item_image'
			: '.screenshot_showcase_primary img, .screenshot_showcase_smallscreenshot.showcase_slot img')];
		setImageInputMode('composite');
		setEditorFiles([]);
		setEditorPreview(currentImages.slice(0, panelCount).map((image) => ({
			src: image.currentSrc || image.src,
			width: image.naturalWidth || image.width || 16,
			height: image.naturalHeight || image.height || 9,
		})));
		setEditorLoading(false);
		setEditorError('');
		setAddingOpen(false);
		setEditingId(entry.id);
		setPublicScreenshotSearch('');
		setPublicScreenshotPage(0);
		setPublicScreenshotExpanded(false);
		setPublicScreenshotNextPage(1);
		setPublicScreenshotHasMore(true);
		if (entry.kind === 'screenshot' && profileUrl) void loadPublicScreenshots(1, false);
	}

	async function loadPublicScreenshots(page: number, append: boolean) {
		setPublicScreenshotsLoading(true);
		setEditorError('');
		try {
			const response = await fetch('/api/profile-screenshots', {
				method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ profileUrl, page }),
			});
			const result = await response.json() as { items?: PublicScreenshot[]; hasMore?: boolean; error?: string };
			if (!response.ok) throw new Error(result.error || 'Could not load public screenshots.');
			setPublicScreenshots((current) => append ? [...new Map([...current, ...(result.items || [])].map((item) => [item.id, item])).values()] : result.items || []);
			setPublicScreenshotNextPage(page + 6);
			setPublicScreenshotHasMore(result.hasMore === true);
		} catch (caught) {
			if (!append) setPublicScreenshots([]);
			setEditorError(caught instanceof Error ? caught.message : 'Could not load public screenshots.');
		} finally {
			setPublicScreenshotsLoading(false);
		}
	}

	async function updateEditorPreview(entry: ShowcaseEntry, files: Array<EditorSource | null>, mode: ImageInputMode) {
		const requestId = ++previewRequestId.current;
		setEditorLoading(true);
		setEditorError('');
		try {
			let panels: Array<PreviewPanel | null>;
			if (mode === 'separate' || mode === 'public') {
				panels = await Promise.all(files.map((file) => file ? readPreviewPanel(file) : Promise.resolve(null)));
			} else if (files[0] && hasTwoPanelImageEditor(entry.kind)) {
				const mosaic = await splitArtworkMosaic(files[0] as File, artworkLayout);
				panels = mosaic.images.map((src, index) => ({ src: mosaic.previewImages?.[index] || src, ...(mosaic.panelDimensions?.[index] || { width: 16, height: 9 }) }));
			} else if (files[0] && entry.kind === 'workshop') {
				const mosaic = await splitWorkshopMosaic(files[0] as File);
				panels = mosaic.images.map((src, index) => ({ src: mosaic.previewImages?.[index] || src, ...(mosaic.panelDimensions?.[index] || { width: 1, height: 1 }) }));
			} else if (files[0]) {
				panels = [await readPreviewPanel(files[0])];
			} else {
				panels = [];
			}
			if (previewRequestId.current === requestId) setEditorPreview(panels);
		} catch (caught) {
			if (previewRequestId.current === requestId) {
				setEditorError(caught instanceof Error ? caught.message : 'Could not prepare the image preview.');
				setEditorPreview([]);
			}
		} finally {
			if (previewRequestId.current === requestId) setEditorLoading(false);
		}
	}

	function selectShowcaseFiles(event: ChangeEvent<HTMLInputElement>) {
		const selected = [...(event.target.files || [])];
		event.target.value = '';
		setShowcaseFiles(selected);
	}

	function setShowcaseFiles(selected: File[]) {
		if (!activeEditor) return;
		const separate = selected.length > 1;
		const mode = separate ? 'separate' : 'composite';
		setImageInputMode(mode);
		const files = separate
			? Array.from({ length: editorPanelCount }, (_, index) => selected[index] || null)
			: selected.slice(0, 1);
		setEditorFiles(files);
		if (selected.length > editorPanelCount && separate) {
			setEditorError(`This layout uses ${editorPanelCount} panels; ${selected.length} files were selected.`);
			setEditorPreview([]);
			return;
		}
		setEditorError('');
		void updateEditorPreview(activeEditor, files, mode);
	}

	function togglePublicScreenshot(screenshot: PublicScreenshot) {
		if (!activeEditor || activeEditor.kind !== 'screenshot') return;
		const publicLayout: ArtworkLayout = 'main-three-side';
		if (artworkLayout !== publicLayout) setArtworkLayout(publicLayout);
		const current = editorFiles.filter((source): source is PublicScreenshot => !!source && isPublicScreenshot(source));
		const publicPanelCount = getMosaicPanelCount(activeEditor.kind, publicLayout);
		if (!current.some((item) => item.id === screenshot.id) && current.length >= publicPanelCount) return;
		const next = current.some((item) => item.id === screenshot.id)
			? current.filter((item) => item.id !== screenshot.id)
			: current.length < publicPanelCount ? [...current, screenshot] : current;
		setImageInputMode('public');
		setEditorFiles(next);
		setEditorError('');
		void updateEditorPreview(activeEditor, next, 'public');
	}

	async function applyEditorChanges() {
		if (!activeEditor) return;
		const files = editorFiles.filter((file): file is EditorSource => file !== null);
		const expectedFiles = imageInputMode === 'separate' || imageInputMode === 'public' ? editorPanelCount : 1;
		if (files.length !== expectedFiles || editorLoading || editorError) return;
		setEditorLoading(true);
		const applied = await updateArtwork(activeEditor, files);
		setEditorLoading(false);
		if (applied) setEditingId(null);
	}

	async function updateArtwork(entry: ShowcaseEntry, files: EditorSource[]): Promise<boolean> {
		if (!files.length) return false;
		if (files.some((file) => !isPublicScreenshot(file) && !/^image\/(png|jpeg|webp|gif|avif|apng)$/.test(file.type))) {
			setEditorError('Choose PNG, JPG, WEBP, GIF, APNG, or AVIF images.');
			return false;
		}
		const panelCount = getMosaicPanelCount(entry.kind, artworkLayout);
		const separateUploads = panelCount > 1 && files.length === panelCount;
		if (files.length !== 1 && !separateUploads) {
			setEditorError(`Choose one complete image or exactly ${panelCount} separate panels.`);
			return false;
		}
		if (hasTwoPanelImageEditor(entry.kind)) {
			const rightColumn = entry.element.querySelector<HTMLElement>('.screenshot_showcase_rightcol');
			if (rightColumn) {
				const sideSlots = [...rightColumn.querySelectorAll<HTMLElement>('.screenshot_showcase_smallscreenshot.showcase_slot')];
				for (let index = sideSlots.length; index < panelCount - 1; index += 1) {
					rightColumn.insertBefore(makeImageSlot(entry.element.ownerDocument, 'screenshot_showcase_smallscreenshot showcase_slot', 100), rightColumn.querySelector('.screenshot_count'));
				}
			}
		}
		const images = [...entry.element.querySelectorAll<HTMLImageElement>(entry.kind === 'workshop'
			? '.myworkshop_showcase .workshop_showcase_item_image'
			: '.screenshot_showcase_primary img, .screenshot_showcase_smallscreenshot img')];
		try {
			let exportWarning = false;
			const fullResolutionImages = files.every(isPublicScreenshot)
				? await (async () => {
					const images: string[] = [];
					for (const file of files) {
						if (file.fullImageUrl) {
							images.push(file.fullImageUrl);
							continue;
						}
						const response = await fetch('/api/screenshot-image', {
							method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ steamUrl: file.steamUrl }),
						});
						const result = await response.json() as { imageUrl?: string; error?: string };
						if (!response.ok || !result.imageUrl) throw new Error(result.error || 'Could not load the full-resolution screenshot.');
						images.push(result.imageUrl);
					}
					return images;
				})()
				: undefined;
			const mosaic = files.every(isPublicScreenshot)
				? { images: fullResolutionImages as string[] }
				: separateUploads
				? { images: await Promise.all(files.map((file) => readImageFile(file as File)) ) }
				: hasTwoPanelImageEditor(entry.kind)
				? await splitArtworkMosaic(files[0] as File, artworkLayout)
				: entry.kind === 'workshop'
					? await splitWorkshopMosaic(files[0] as File)
					: { images: [await new Promise<string>((resolve, reject) => {
					const reader = new FileReader();
					reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Could not read artwork image.'));
					reader.onerror = () => reject(new Error('Could not read artwork image.'));
					reader.readAsDataURL(files[0] as File);
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
				if (entry.kind === 'workshop') {
					image.style.display = 'block';
					image.style.width = '100%';
					image.style.maxWidth = '100%';
					image.style.minHeight = '0';
					image.style.objectFit = 'fill';
					image.style.transformOrigin = 'top left';
					if (anchor) {
						anchor.style.display = 'block';
						anchor.style.width = '100%';
						anchor.style.overflow = 'hidden';
					}
					if (!mosaic.animated) {
						image.style.height = 'auto';
						image.style.transform = 'none';
					}
				}
				if (mosaic.animated && anchor) {
					anchor.style.display = 'block';
					anchor.style.overflow = 'hidden';
					const panelRegions = mosaic.animated.panelRegions || (mosaic.animated.panelWidths || [mosaic.animated.mainWidth, mosaic.animated.width - mosaic.animated.mainWidth]).map((width, panelIndex, widths) => ({
						x: widths.slice(0, panelIndex).reduce((total, value) => total + value, 0), y: 0, width, height: mosaic.animated!.height,
					}));
					const region = panelRegions[index];
					anchor.style.height = `${region.height}px`;
					anchor.style.width = entry.kind === 'workshop' || index === 0 ? '100%' : `${region.width}px`;
					image.style.width = `${mosaic.animated.width}px`;
					image.style.height = `${mosaic.animated.height}px`;
					image.style.maxWidth = 'none';
					image.style.minHeight = '0';
					image.style.objectFit = 'fill';
					image.style.transform = region.x || region.y ? `translate(${-region.x}px, ${-region.y}px)` : 'none';
					image.style.transformOrigin = 'top left';
				}
			}
			if (hasTwoPanelImageEditor(entry.kind)) {
				const sideSlots = [...entry.element.querySelectorAll<HTMLElement>('.screenshot_showcase_smallscreenshot.showcase_slot')];
				const panelCount = getMosaicPanelCount(entry.kind, artworkLayout);
				sideSlots.slice(panelCount - 1).forEach((slot) => slot.remove());
				entry.element.dataset.steamcanvasMosaic = 'true';
				entry.element.dataset.steamcanvasMosaicPanels = String(panelCount);
				const baseName = sourceName(files[0]).replace(/\.[^.]+$/, '').replace(/[^\w.-]+/g, '-').slice(0, 80) || (entry.kind === 'screenshot' ? 'steam-screenshot' : 'steam-artwork');
				if (mosaic.animated?.format === 'gif') {
					try {
						const gifPanels = await encodeAnimatedMosaic(files[0] as File, mosaic.animated);
						setEntries((current) => current.map((item) => item.id !== entry.id ? item : {
							...item,
							exportFiles: gifPanels.map((url, index) => ({ name: `${baseName}-${index === 0 ? 'main' : panelCount === 2 ? 'side' : `side-${index}`}.gif`, url })),
							animatedArtwork: undefined,
						}));
					} catch (caught) {
						const reason = caught instanceof Error ? caught.message : 'GIF export could not be completed.';
						setEntries((current) => current.map((item) => item.id !== entry.id ? item : {
							...item,
							exportFiles: undefined,
							animatedArtwork: { name: sourceName(files[0]), url: mosaic.images[0] },
						}));
						exportWarning = true;
						setError(`${reason} The original animated file is available to download.`);
					}
				} else if (mosaic.animated) {
					setEntries((current) => current.map((item) => item.id !== entry.id ? item : {
						...item,
						exportFiles: undefined,
						animatedArtwork: { name: sourceName(files[0]), url: mosaic.images[0] },
					}));
				} else {
					setEntries((current) => current.map((item) => item.id !== entry.id ? item : {
						...item,
						exportFiles: mosaic.images.map((url, index) => ({
							name: `${baseName}-${index === 0 ? 'main' : panelCount === 2 ? 'side' : `side-${index}`}.${separateUploads && !isPublicScreenshot(files[index]) ? getImageExtension(files[index]) : 'png'}`,
							url,
						})),
						animatedArtwork: undefined,
					}));
				}
			}
			if (entry.kind === 'workshop') {
			const baseName = sourceName(files[0]).replace(/\.[^.]+$/, '').replace(/[^\w.-]+/g, '-').slice(0, 80) || 'steam-workshop';
				if (mosaic.animated?.format === 'gif') {
					try {
						const gifPanels = await encodeAnimatedMosaic(files[0] as File, mosaic.animated);
						setEntries((current) => current.map((item) => item.id !== entry.id ? item : {
							...item,
							exportFiles: gifPanels.map((url, index) => ({ name: `${baseName}-${index + 1}.gif`, url })),
							animatedArtwork: undefined,
						}));
					} catch (caught) {
						const reason = caught instanceof Error ? caught.message : 'GIF export could not be completed.';
						setEntries((current) => current.map((item) => item.id !== entry.id ? item : {
							...item,
							exportFiles: undefined,
							animatedArtwork: { name: sourceName(files[0]), url: mosaic.images[0] },
						}));
						exportWarning = true;
						setError(`${reason} The original animated file is available to download.`);
					}
				} else if (mosaic.animated) {
					setEntries((current) => current.map((item) => item.id !== entry.id ? item : {
						...item,
						exportFiles: undefined,
						animatedArtwork: { name: sourceName(files[0]), url: mosaic.images[0] },
					}));
				} else {
					setEntries((current) => current.map((item) => item.id !== entry.id ? item : {
						...item,
						exportFiles: mosaic.images.map((url, index) => ({ name: `${baseName}-${index + 1}.${separateUploads && !isPublicScreenshot(files[index]) ? getImageExtension(files[index]) : 'png'}`, url })),
						animatedArtwork: undefined,
					}));
				}
			}
			if (!exportWarning) {
				setError('');
				setEditorError('');
			}
			return true;
		} catch (caught) {
			setEditorError(caught instanceof Error ? caught.message : 'Could not prepare these images.');
			return false;
		}
	}

	async function downloadArtwork(entry: ShowcaseEntry) {
		if (entry.exportFiles?.length === getExportPanelCount(entry)) {
			try {
				const archive = new JSZip();
				for (const file of entry.exportFiles) {
					const response = await fetch(file.url);
					if (!response.ok) throw new Error(`Could not read ${file.name}.`);
					archive.file(file.name, await response.blob());
				}
				const blob = await archive.generateAsync({ type: 'blob' });
				const url = URL.createObjectURL(blob);
				const baseName = entry.exportFiles[0].name.replace(/-(?:main|side(?:-\d+)?|[1-5])\.(?:png|jpe?g|webp|gif|apng|avif)$/i, '') || 'steam-artwork';
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
	const screenshotPreviewHeight = Math.max(1, Math.round(506 * (editorPreview[0]?.height || 284) / (editorPreview[0]?.width || 506)));
	const previewPanelSize = (index: number) => activeEditor?.kind === 'screenshot'
		? index === 0
			? { src: editorPreview[index]?.src || '', width: 506, height: screenshotPreviewHeight }
			: { src: editorPreview[index]?.src || '', width: 100, height: editorPanelCount === 4 ? Math.max(1, Math.round((screenshotPreviewHeight - 8) / 3)) : screenshotPreviewHeight }
		: editorPreview[index] || (activeEditor?.kind === 'workshop'
		? { src: '', width: 126, height: 56 }
		: index === 0 ? { src: '', width: 506, height: 284 } : { src: '', width: 100, height: 56 });
	const previewSizes = Array.from({ length: editorPanelCount }, (_, index) => previewPanelSize(index));
	const previewWidth = activeEditor?.kind === 'workshop' ? previewSizes.reduce((sum, panel) => sum + panel.width, 0) : activeEditor?.kind === 'featured-artwork' ? previewSizes[0].width : previewSizes[0].width + (previewSizes[1]?.width || 100);
	const previewHeight = activeEditor?.kind === 'workshop'
		? Math.max(...previewSizes.map((panel) => panel.height))
		: editorPanelCount === 4
			? Math.max(previewSizes[0].height, previewSizes.slice(1).reduce((sum, panel) => sum + panel.height, 0) + 8)
			: Math.max(...previewSizes.map((panel) => panel.height));
	const previewAspectRatio = previewWidth / Math.max(1, previewHeight);
	const previewRenderWidth = Math.min(480, 390 * previewAspectRatio);
	const isAnimatedPreview = imageInputMode === 'composite' && !!editorFiles[0] && !isPublicScreenshot(editorFiles[0]) && /\.(gif|apng)$/i.test(editorFiles[0].name);
	const publicScreenshotMatches = publicScreenshots.filter((screenshot) => !publicScreenshotSearch.trim() || `${screenshot.id} ${screenshot.steamUrl}`.toLowerCase().includes(publicScreenshotSearch.trim().toLowerCase()));
	const publicScreenshotPageSize = publicScreenshotExpanded ? 9 : 6;
	const publicScreenshotPageCount = Math.max(1, Math.ceil(publicScreenshotMatches.length / publicScreenshotPageSize));
	const visiblePublicScreenshots = publicScreenshotMatches.slice(publicScreenshotPage * publicScreenshotPageSize, (publicScreenshotPage + 1) * publicScreenshotPageSize);
	const previewStyle: CSSProperties = {
		width: `min(100%, ${previewRenderWidth}px)`,
		aspectRatio: `${previewWidth} / ${previewHeight}`,
		gridTemplateColumns: activeEditor?.kind === 'workshop'
			? previewSizes.map((panel) => `${panel.width}fr`).join(' ')
			: activeEditor?.kind === 'featured-artwork' ? '1fr' : `${previewSizes[0].width}fr ${previewSizes[1]?.width || 100}fr`,
	};
	const renderPreviewPanel = (index: number, label: string, extraClass = '') => <div className={`showcase-editor-preview-panel ${extraClass}`} key={index} style={{ aspectRatio: `${previewPanelSize(index).width} / ${previewPanelSize(index).height}` }}>
		<span>{label}</span>
		{editorPreview[index]?.src ? <img src={editorPreview[index].src} alt={`Preview ${label.toLowerCase()}`} /> : <div className="showcase-editor-preview-empty">{editorLoading ? 'Preparing preview...' : 'Preview appears here'}</div>}
	</div>;
	const renderOverlay = (entry: ShowcaseEntry, host: HTMLElement) => {
		return createPortal(
		<div className="showcase-overlay" style={{ position: 'absolute', inset: 0, pointerEvents: 'none', outline: dragTargetShowcaseId === entry.id ? '3px solid #c9ef73' : hoveredShowcaseId === entry.id ? '2px solid rgba(201,239,115,.9)' : undefined, outlineOffset: '-2px', background: dragTargetShowcaseId === entry.id ? 'rgba(196,243,106,.1)' : hoveredShowcaseId === entry.id ? 'rgba(196,243,106,.035)' : undefined, transition: 'outline-color .12s ease, background .12s ease' }}>
			<div className="showcase-overlay-actions" style={{ position: 'absolute', top: '5px', right: '5px', display: 'flex', alignItems: 'center', gap: '6px', padding: '3px', borderRadius: '4px', background: 'rgba(12,17,21,.78)', backdropFilter: 'blur(4px)', pointerEvents: 'auto' }}>
				<button type="button" style={buttonStyle} title={`Edit ${entry.title}`} aria-label={`Edit ${entry.title}`} onClick={() => openEditor(entry)}><Pencil size={14} />Edit</button>
				<button type="button" style={{ ...buttonStyle, width: '30px', padding: 0, justifyContent: 'center', color: '#ffc0b5' }} title={`Remove ${entry.title}`} aria-label={`Remove ${entry.title}`} onClick={() => { removeShowcase(entry); if (editingId === entry.id) setEditingId(null); }}><Trash2 size={14} /></button>
				{(hasTwoPanelImageEditor(entry.kind) || entry.kind === 'workshop') && ((entry.exportFiles?.length === getExportPanelCount(entry)) || entry.animatedArtwork) && <button type="button" style={buttonStyle} title={entry.exportFiles ? 'Download image panels as ZIP' : 'Download original animation'} aria-label={`${entry.exportFiles ? 'Download ZIP' : 'Download original'} for ${entry.title}`} onClick={() => void downloadArtwork(entry)}><Download size={14} />{entry.exportFiles ? 'Download ZIP' : 'Download original'}</button>}
			</div>
		</div>, host, entry?.id || 'showcase-add-controls');
	};
	const renderAddControl = (host: HTMLElement) => createPortal(
		<div style={{ position: 'relative' }}>
			<button type="button" className="showcase-add-trigger" style={floatingAddButtonStyle} title="Add showcase" aria-label="Add showcase" onClick={() => { setAddingOpen((open) => !open); setEditingId(null); }}><Plus size={18} color="#ffffff" />Add showcase</button>
			{addingOpen && <div style={addPopoverStyle} onClick={(event) => event.stopPropagation()}>
				<div style={{ marginBottom: '10px', color: '#e9eef0', fontSize: '14px', fontWeight: 700 }}>Add a showcase</div>
				<label style={{ display: 'grid', gap: '5px', marginBottom: '10px' }}><span>Showcase type</span><select style={fieldStyle} value={newShowcaseKind} onChange={(event) => setNewShowcaseKind(event.target.value as CreatableShowcaseKind)}><option value="artwork">Artwork</option><option value="featured-artwork">Featured artwork</option><option value="screenshot">Screenshot</option><option value="workshop">Workshop</option></select></label>
				<button type="button" style={{ ...buttonStyle, width: '100%', marginTop: '2px', background: '#52752a', borderColor: '#789c42', color: '#ffffff' }} onClick={addShowcase}><Plus size={14} color="#ffffff" />Add</button>
				{error && <div role="alert" style={{ marginTop: '7px', color: '#ffb8ad' }}>{error}</div>}
			</div>}
		</div>, host, 'showcase-add-controls');

	if (!previewDocument) return null;
	return <>
		{entries.map((entry) => renderOverlay(entry, entry.host))}
		{addControlHost && renderAddControl(addControlHost)}
		<dialog
			ref={editorDialogRef}
			className="showcase-editor-dialog"
			aria-labelledby="showcase-editor-title"
			onClose={() => setEditingId(null)}
			onCancel={(event) => { event.preventDefault(); setEditingId(null); }}
			onClick={(event) => { if (event.target === event.currentTarget) setEditingId(null); }}
		>
			{activeEditor && <div className="showcase-editor-content">
				<header className="showcase-editor-header">
					<div><span className="source-label">SHOWCASE EDITOR</span><h2 id="showcase-editor-title">{activeEditor.title}</h2></div>
					<button className="icon-button" type="button" aria-label="Close editor" title="Close editor" onClick={() => setEditingId(null)}><X size={17} /></button>
				</header>
				{activeEditor.kind !== 'other' && <>
					<div className="showcase-editor-layout">
						<div className="showcase-editor-preview" aria-busy={editorLoading}>
							<div className="showcase-editor-preview-heading"><strong>Preview</strong><span>{isAnimatedPreview ? 'GIF · first frame' : activeEditor.kind === 'featured-artwork' ? 'Single image' : `${editorPanelCount} panels`}</span></div>
							<div className={`showcase-editor-preview-panels ${activeEditor.kind === 'workshop' ? 'is-workshop' : activeEditor.kind === 'featured-artwork' ? 'is-featured' : editorPanelCount === 4 ? 'is-four-panel' : 'is-two-panel'}`} style={previewStyle}>
								{activeEditor.kind === 'workshop'
									? Array.from({ length: 5 }, (_, index) => renderPreviewPanel(index, `Panel ${index + 1}`))
									: editorPanelCount === 4
										? <>{renderPreviewPanel(0, 'Main')}<div className="showcase-editor-preview-side-stack">{[1, 2, 3].map((index) => renderPreviewPanel(index, `Side ${index}`, 'is-side'))}</div></>
										: editorPanelCount === 2
											? <>{renderPreviewPanel(0, 'Main')}{renderPreviewPanel(1, 'Side')}</>
											: renderPreviewPanel(0, 'Featured image')}
							</div>
						</div>
						<aside className="showcase-editor-controls">
							{(activeEditor.kind === 'artwork' || activeEditor.kind === 'screenshot') && <div className="showcase-editor-control-group"><span className="showcase-editor-label">LAYOUT</span><div className="showcase-editor-layout-choice" role="group" aria-label="Showcase layout">
								<button className={artworkLayout === 'main-side' ? 'is-active' : ''} type="button" aria-pressed={artworkLayout === 'main-side'} onClick={() => { setArtworkLayout('main-side'); setEditorFiles([]); setEditorPreview([]); setEditorError(''); }}><span className="showcase-layout-icon is-two"><i /><i /></span><span className="showcase-layout-copy"><strong>Main + side</strong><small>2 panels</small></span></button>
								<button className={artworkLayout === 'main-three-side' ? 'is-active' : ''} type="button" aria-pressed={artworkLayout === 'main-three-side'} onClick={() => { setArtworkLayout('main-three-side'); setEditorFiles([]); setEditorPreview([]); setEditorError(''); }}><span className="showcase-layout-icon is-four"><i /><i /><i /><i /></span><span className="showcase-layout-copy"><strong>Main + 3 sides</strong><small>4 panels</small></span></button>
							</div></div>}
							{activeEditor.kind === 'screenshot' && <div className={`showcase-public-picker ${publicScreenshotExpanded ? 'is-expanded' : ''}`}>
								<div className="showcase-editor-label">PUBLIC SCREENSHOTS</div>
								<p className="showcase-public-picker-copy">Choose up to {editorPanelCount} screenshots from this profile. They stay whole in the showcase slots.</p>
								{publicScreenshotsLoading && !publicScreenshots.length ? <div className="showcase-public-picker-status">Loading public screenshots...</div> : publicScreenshots.length ? <>
									<div className="showcase-public-toolbar">
										{publicScreenshotExpanded && <input autoFocus className="showcase-public-search" type="search" value={publicScreenshotSearch} onChange={(event) => { setPublicScreenshotSearch(event.target.value); setPublicScreenshotPage(0); }} placeholder="Search screenshots" aria-label="Search public screenshots" />}
										<button className="showcase-public-expand" type="button" aria-label={publicScreenshotExpanded ? 'Close screenshot browser' : 'Open screenshot browser'} title={publicScreenshotExpanded ? 'Close screenshot browser' : 'Browse and search screenshots'} onClick={() => { setPublicScreenshotExpanded((expanded) => !expanded); setPublicScreenshotPage(0); }}><Search size={15} /></button>
									</div>
									<div className="showcase-public-grid">
									{visiblePublicScreenshots.map((screenshot) => {
										const selectedIndex = editorFiles.findIndex((source) => !!source && isPublicScreenshot(source) && source.id === screenshot.id);
										return <button key={screenshot.id} type="button" className={`showcase-public-item ${selectedIndex >= 0 ? 'is-selected' : ''}`} aria-pressed={selectedIndex >= 0} title={selectedIndex >= 0 ? `Selected as slot ${selectedIndex + 1}` : 'Use this screenshot'} onClick={() => togglePublicScreenshot(screenshot)}>
											<img src={screenshot.thumbnailUrl} alt="" /><span>{selectedIndex >= 0 ? `Slot ${selectedIndex + 1}` : 'Select'}</span>
										</button>;
									})}
									</div>
									{publicScreenshotExpanded && <div className="showcase-public-pagination"><button type="button" aria-label="Previous screenshot page" title="Previous page" disabled={publicScreenshotPage === 0} onClick={() => setPublicScreenshotPage((page) => Math.max(0, page - 1))}><ChevronLeft size={14} /></button><span>{publicScreenshotPage + 1} / {publicScreenshotPageCount}</span><button type="button" aria-label="Next screenshot page" title="Next page" disabled={publicScreenshotPage >= publicScreenshotPageCount - 1} onClick={() => setPublicScreenshotPage((page) => Math.min(publicScreenshotPageCount - 1, page + 1))}><ChevronRight size={14} /></button></div>}
									{publicScreenshotExpanded && publicScreenshotHasMore && <button className="showcase-public-load-more" type="button" disabled={publicScreenshotsLoading} onClick={() => void loadPublicScreenshots(publicScreenshotNextPage, true)}>{publicScreenshotsLoading ? 'Loading more...' : 'Load more screenshots'}</button>}
								</> : <div className="showcase-public-picker-status">No public screenshots were found on this profile.</div>}
							</div>}
							<label className={`showcase-editor-upload ${editorPanelCount > 1 ? 'is-multiple' : ''}`} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); setShowcaseFiles([...event.dataTransfer.files]); }}>
								<ImagePlus size={19} />
								<span>
									<strong>{editorFiles.filter(Boolean).length ? imageInputMode === 'separate' || imageInputMode === 'public' ? `${editorFiles.filter(Boolean).length} of ${editorPanelCount} panels ready` : sourceName(editorFiles[0] as EditorSource) : editorPanelCount > 1 ? 'Drop one image or choose ready-made panels' : 'Drop or choose an image'}</strong>
									<small>{editorPanelCount > 1 ? `One image is split automatically. Or select ${editorPanelCount} files in preview order.` : 'Image or animated GIF'}</small>
									{(imageInputMode === 'separate' || imageInputMode === 'public') && editorFiles.filter(Boolean).length > 0 && <small className="showcase-editor-file-list">{editorFiles.filter((file): file is EditorSource => !!file).map(sourceName).join(' · ')}</small>}
								</span>
								<input type="file" multiple={editorPanelCount > 1} accept="image/png,image/jpeg,image/webp,image/gif,image/apng,image/avif" onChange={selectShowcaseFiles} />
							</label>
						</aside>
					</div>
				</>}
				{editorError && <p className="showcase-editor-error" role="alert">{editorError}</p>}
				<footer className="showcase-editor-footer">
					<button className="showcase-editor-remove" type="button" onClick={() => { removeShowcase(activeEditor); setEditingId(null); }}><Trash2 size={15} /> Remove showcase</button>
					<button className="showcase-editor-cancel" type="button" onClick={() => setEditingId(null)}>Cancel</button>
					{activeEditor.kind !== 'other' && <button className="showcase-editor-apply" type="button" disabled={editorLoading || !!editorError || editorFiles.filter(Boolean).length !== (imageInputMode === 'separate' || imageInputMode === 'public' ? editorPanelCount : 1)} onClick={() => void applyEditorChanges()}>{editorLoading ? 'Preparing...' : 'Apply to preview'}</button>}
				</footer>
			</div>}
		</dialog>
	</>;
}

async function readPreviewPanel(source: EditorSource): Promise<PreviewPanel> {
	const src = isPublicScreenshot(source) ? source.thumbnailUrl : await readImageFile(source);
	const image = new Image();
	image.src = src;
	await image.decode();
	return { src, width: image.naturalWidth || 16, height: image.naturalHeight || Math.round(16 / (isPublicScreenshot(source) ? source.aspectRatio || 1.7778 : 1.7778)) };
}

function cropImagePreview(image: HTMLImageElement, width: number, height: number, regions: Array<{ x: number; y: number; width: number; height: number }>): string[] {
	const composite = document.createElement('canvas');
	composite.width = width;
	composite.height = height;
	const context = composite.getContext('2d');
	if (!context) throw new Error('Could not prepare the image preview.');
	context.drawImage(image, 0, 0, width, height);
	return regions.map(({ x, y, width: panelWidth, height: panelHeight }) => {
		const panel = document.createElement('canvas');
		panel.width = panelWidth;
		panel.height = panelHeight;
		const panelContext = panel.getContext('2d');
		if (!panelContext) throw new Error('Could not prepare a panel preview.');
		panelContext.drawImage(composite, x, y, panelWidth, panelHeight, 0, 0, panelWidth, panelHeight);
		return panel.toDataURL('image/png');
	});
}