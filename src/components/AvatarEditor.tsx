import { useEffect, useRef, useState, type ChangeEvent, type PointerEvent } from 'react';
import { Check, RotateCcw, RotateCw, Upload, X } from 'lucide-react';

export type AvatarEditState = { imageUrl: string | null };

export const DEFAULT_AVATAR_EDIT: AvatarEditState = { imageUrl: null };

type AvatarEditorProps = {
  sourceAvatar?: string;
  value: AvatarEditState;
  onChange: (next: AvatarEditState) => void;
};

const cropSize = 512;

type CropOffset = { x: number; y: number };

type DragStart = {
  pointerX: number;
  pointerY: number;
  offset: CropOffset;
};

function readImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Could not read this image.'));
    reader.onerror = () => reject(new Error('Could not read this image.'));
    reader.readAsDataURL(file);
  });
}

function getCropBounds(image: HTMLImageElement, zoom: number, rotation: number) {
  const quarterTurn = Math.abs(rotation % 180) === 90;
  const width = quarterTurn ? image.naturalHeight : image.naturalWidth;
  const height = quarterTurn ? image.naturalWidth : image.naturalHeight;
  const scale = Math.max(cropSize / width, cropSize / height) * zoom;
  return {
    x: Math.max(0, (width * scale - cropSize) / 2),
    y: Math.max(0, (height * scale - cropSize) / 2),
  };
}

function drawCrop(canvas: HTMLCanvasElement, image: HTMLImageElement, zoom: number, rotation: number, offset: CropOffset) {
  const context = canvas.getContext('2d');
  if (!context) return;

  const quarterTurn = Math.abs(rotation % 180) === 90;
  const width = quarterTurn ? image.naturalHeight : image.naturalWidth;
  const height = quarterTurn ? image.naturalWidth : image.naturalHeight;
  const scale = Math.max(cropSize / width, cropSize / height) * zoom;

  context.clearRect(0, 0, cropSize, cropSize);
  context.save();
  context.beginPath();
  context.rect(0, 0, cropSize, cropSize);
  context.clip();
  context.translate(cropSize / 2 + offset.x, cropSize / 2 + offset.y);
  context.rotate(rotation * Math.PI / 180);
  context.scale(scale, scale);
  context.drawImage(image, -image.naturalWidth / 2, -image.naturalHeight / 2);
  context.restore();
}

export default function AvatarEditor({ sourceAvatar, value, onChange }: AvatarEditorProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cropImageRef = useRef<HTMLImageElement>(null);
  const cropCanvasRef = useRef<HTMLCanvasElement>(null);
  const dragStart = useRef<DragStart | null>(null);
  const [error, setError] = useState('');
  const [cropSource, setCropSource] = useState<string | null>(null);
  const [imageReady, setImageReady] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [offset, setOffset] = useState<CropOffset>({ x: 0, y: 0 });
  const imageSource = value.imageUrl || sourceAvatar;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (cropSource && !dialog.open) dialog.showModal();
    if (!cropSource && dialog.open) dialog.close();
  }, [cropSource]);

  useEffect(() => {
    const image = cropImageRef.current;
    const canvas = cropCanvasRef.current;
    if (imageReady && image && canvas) drawCrop(canvas, image, zoom, rotation, offset);
  }, [imageReady, offset, rotation, zoom]);

  async function handleUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!/^image\/(png|jpeg|webp|gif|avif)$/.test(file.type)) {
      setError('Choose a PNG, JPG, WEBP, GIF, or AVIF image.');
      return;
    }
    if (file.size > 15 * 1024 * 1024) {
      setError('Image must be smaller than 15 MB.');
      return;
    }

    try {
      const dataUrl = await readImage(file);
      const image = new Image();
      image.src = dataUrl;
      await image.decode();
      setCropSource(dataUrl);
      setImageReady(false);
      setZoom(1);
      setRotation(0);
      setOffset({ x: 0, y: 0 });
      setError('');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not read this image.');
    }
  }

  function closeCropDialog() {
    dragStart.current = null;
    setIsDragging(false);
    setCropSource(null);
    setImageReady(false);
  }

  function applyCrop() {
    const canvas = cropCanvasRef.current;
    const image = cropImageRef.current;
    if (!canvas || !image || !imageReady) return;
    drawCrop(canvas, image, zoom, rotation, offset);
    onChange({ imageUrl: canvas.toDataURL('image/png') });
    closeCropDialog();
  }

  function rotate(degrees: number) {
    const image = cropImageRef.current;
    const nextRotation = (rotation + degrees + 360) % 360;
    setRotation(nextRotation);
    if (image?.naturalWidth) {
      const bounds = getCropBounds(image, zoom, nextRotation);
      setOffset((current) => ({ x: Math.max(-bounds.x, Math.min(bounds.x, current.x)), y: Math.max(-bounds.y, Math.min(bounds.y, current.y)) }));
    }
  }

  function handlePointerDown(event: PointerEvent<HTMLCanvasElement>) {
    if (!cropCanvasRef.current || !cropImageRef.current?.naturalWidth) return;
    const canvasBounds = cropCanvasRef.current.getBoundingClientRect();
    cropCanvasRef.current.setPointerCapture(event.pointerId);
    dragStart.current = {
      pointerX: event.clientX,
      pointerY: event.clientY,
      offset: { ...offset },
    };
    if (canvasBounds.width === 0) dragStart.current = null;
    setIsDragging(Boolean(dragStart.current));
  }

  function handlePointerMove(event: PointerEvent<HTMLCanvasElement>) {
    const start = dragStart.current;
    const canvas = cropCanvasRef.current;
    const image = cropImageRef.current;
    if (!start || !canvas || !image?.naturalWidth) return;

    const scale = cropSize / canvas.getBoundingClientRect().width;
    const bounds = getCropBounds(image, zoom, rotation);
    const x = start.offset.x + (event.clientX - start.pointerX) * scale;
    const y = start.offset.y + (event.clientY - start.pointerY) * scale;
    setOffset({ x: Math.max(-bounds.x, Math.min(bounds.x, x)), y: Math.max(-bounds.y, Math.min(bounds.y, y)) });
  }

  function handlePointerEnd(event: PointerEvent<HTMLCanvasElement>) {
    dragStart.current = null;
    setIsDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  function handleZoom(event: ChangeEvent<HTMLInputElement>) {
    const nextZoom = Number(event.target.value);
    setZoom(nextZoom);
    const image = cropImageRef.current;
    if (image?.naturalWidth) {
      const bounds = getCropBounds(image, nextZoom, rotation);
      setOffset((current) => ({ x: Math.max(-bounds.x, Math.min(bounds.x, current.x)), y: Math.max(-bounds.y, Math.min(bounds.y, current.y)) }));
    }
  }

  return (
    <section className="avatar-editor" aria-labelledby="avatar-editor-title">
      <div className="avatar-editor-heading">
        <span className="source-label">AVATAR</span>
        <button className="icon-button" type="button" title="Reset avatar" aria-label="Reset avatar" onClick={() => { onChange(DEFAULT_AVATAR_EDIT); setError(''); }}>
          <RotateCcw size={15} />
        </button>
      </div>
      <div className="avatar-editor-preview-row">
        <div className="avatar-editor-preview">
          {imageSource && <img src={imageSource} alt="Current avatar" />}
        </div>
        <div className="avatar-upload-actions">
          <button className="avatar-upload-button" type="button" onClick={() => inputRef.current?.click()}>
            <Upload size={14} /> Replace image
          </button>
          <input ref={inputRef} className="visually-hidden" type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/avif" onChange={handleUpload} />
        </div>
      </div>
      {error && <p className="avatar-editor-error" role="alert">{error}</p>}

      {cropSource && <img ref={cropImageRef} className="visually-hidden" src={cropSource} alt="" onLoad={() => setImageReady(true)} />}
      <dialog
        ref={dialogRef}
        className="avatar-crop-dialog"
        aria-labelledby="avatar-crop-title"
        onCancel={(event) => { event.preventDefault(); closeCropDialog(); }}
        onClick={(event) => { if (event.target === dialogRef.current) closeCropDialog(); }}
      >
        <div className="crop-dialog-content">
          <header className="crop-dialog-header">
            <div>
              <span className="source-label">AVATAR EDITOR</span>
              <h2 id="avatar-crop-title">Crop image</h2>
            </div>
            <button className="icon-button" type="button" title="Close crop editor" aria-label="Close crop editor" onClick={closeCropDialog}><X size={17} /></button>
          </header>
          <p className="crop-instruction">Drag the image to position it inside the square.</p>
          <canvas
            ref={cropCanvasRef}
            className={`crop-canvas ${isDragging ? 'is-dragging' : ''}`}
            width={cropSize}
            height={cropSize}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerEnd}
            onPointerCancel={handlePointerEnd}
            aria-label="Square avatar crop area"
          />
          <div className="crop-tools">
            <div className="crop-rotate-tools" role="group" aria-label="Rotate image">
              <button className="crop-tool-button" type="button" title="Rotate left 90 degrees" aria-label="Rotate left 90 degrees" onClick={() => rotate(-90)}><RotateCcw size={17} /></button>
              <button className="crop-tool-button" type="button" title="Rotate right 90 degrees" aria-label="Rotate right 90 degrees" onClick={() => rotate(90)}><RotateCw size={17} /></button>
            </div>
            <label className="crop-zoom-control" htmlFor="crop-zoom">
              <span>Zoom</span><span>{zoom.toFixed(1)}×</span>
              <input id="crop-zoom" type="range" min="1" max="4" step="0.05" value={zoom} onChange={handleZoom} />
            </label>
          </div>
          <footer className="crop-dialog-footer">
            <button className="crop-cancel-button" type="button" onClick={closeCropDialog}>Cancel</button>
            <button className="crop-apply-button" type="button" disabled={!imageReady} onClick={applyCrop}><Check size={15} /> Apply</button>
          </footer>
        </div>
      </dialog>
    </section>
  );
}