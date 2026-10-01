declare module 'gifenc' {
	export type PaletteColor = number[];

	export type GifEncoder = {
		writeFrame(index: Uint8Array, width: number, height: number, options?: {
			palette?: PaletteColor[];
			delay?: number;
			repeat?: number;
			transparent?: boolean;
			transparentIndex?: number;
			dispose?: number;
		}): void;
		finish(): void;
		bytes(): Uint8Array;
	};

	export function GIFEncoder(options?: { initialCapacity?: number; auto?: boolean }): GifEncoder;
	export function quantize(rgba: Uint8Array | Uint8ClampedArray, maxColors: number, options?: { format?: string; oneBitAlpha?: boolean | number }): PaletteColor[];
	export function applyPalette(rgba: Uint8Array | Uint8ClampedArray, palette: PaletteColor[], format?: string): Uint8Array;
}