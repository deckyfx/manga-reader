import { FabricImage, type Canvas } from "fabric";
import { pageFileUrl, type MaskLayerName } from "../../api";
import type { PageSize } from "./geometry";

/** A box in page pixels. */
export interface Area {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Overlay colours: blue for the detector's mask, green for painted-in text, red for erased pixels. */
const LAYER_COLORS = { detector: "#38bdf8", add: "#22c55e", erase: "#ef4444" } as const;
const LAYER_OPACITY = { detector: 0.35, add: 0.55, erase: 0.55 } as const;
const LAYER_FILES = { detector: "mask.png", add: "mask-add.png", erase: "mask-erase.png" } as const;

type LayerId = keyof typeof LAYER_COLORS;

const PAINTED: readonly MaskLayerName[] = ["add", "erase"];

/** One brush stroke: the pixels of both painted layers around it before and after, for undo and redo. */
export interface StrokeRecord {
  layer: MaskLayerName;
  area: Area;
  before: Record<MaskLayerName, ImageData>;
  after: Record<MaskLayerName, ImageData>;
  /** Layers whose pixels the stroke changed (only those need saving). */
  touched: Record<MaskLayerName, boolean>;
}

function pageCanvas(page: PageSize): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = page.width;
  canvas.height = page.height;
  return canvas;
}

function context(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Canvas 2D is not available");
  return ctx;
}

function rgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function sameData(a: ImageData, b: ImageData): boolean {
  for (let i = 0; i < a.data.length; i++) if (a.data[i] !== b.data[i]) return false;
  return true;
}

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

/**
 * The page's text mask as editable overlay layers: the detector's mask (read only) and the painted add / erase layers.
 * Layers are page-size offscreen canvases shown through Fabric images, so strokes draw straight into them at page
 * resolution whatever the zoom. A stroke on one painted layer clears the other under it: the server lets erase win,
 * so without that, painting text back over an erased spot would silently do nothing.
 */
export class MaskLayers {
  private readonly layers: Record<LayerId, HTMLCanvasElement>;
  /** Copies of the painted layers from when the current stroke began. */
  private readonly snapshots: Record<MaskLayerName, HTMLCanvasElement>;
  private readonly images: FabricImage[];
  private stroke: { layer: MaskLayerName; size: number; last: { x: number; y: number }; minX: number; minY: number; maxX: number; maxY: number } | null = null;

  constructor(private readonly pageId: string, private readonly page: PageSize) {
    this.layers = { detector: pageCanvas(page), add: pageCanvas(page), erase: pageCanvas(page) };
    this.snapshots = { add: pageCanvas(page), erase: pageCanvas(page) };
    this.images = (["detector", "add", "erase"] as const).map((id) => new FabricImage(this.layers[id], {
      originX: "left",
      originY: "top",
      left: 0,
      top: 0,
      opacity: LAYER_OPACITY[id],
      selectable: false,
      evented: false,
      objectCaching: false,
      visible: false,
    }));
  }

  /** Loads the detector's mask and the saved painted layers; a missing file leaves its layer empty. */
  async load(signal: AbortSignal): Promise<void> {
    const version = Date.now();
    await Promise.all((Object.keys(LAYER_FILES) as LayerId[]).map(async (id) => {
      const res = await fetch(pageFileUrl(this.pageId, LAYER_FILES[id], version), { signal });
      if (res.status === 404) return;
      if (!res.ok) throw new Error(`${LAYER_FILES[id]}: HTTP ${res.status}`);
      const bitmap = await createImageBitmap(await res.blob());
      const ctx = context(this.layers[id]);
      const { width, height } = this.page;
      ctx.clearRect(0, 0, width, height);
      ctx.drawImage(bitmap, 0, 0, width, height);
      bitmap.close();
      // White-on-black PNG → the layer's colour where set, transparent elsewhere
      const image = ctx.getImageData(0, 0, width, height);
      const [r, g, b] = rgb(LAYER_COLORS[id]);
      const px = image.data;
      for (let i = 0; i < px.length; i += 4) {
        const on = px[i] >= 128;
        px[i] = r;
        px[i + 1] = g;
        px[i + 2] = b;
        px[i + 3] = on ? 255 : 0;
      }
      ctx.putImageData(image, 0, 0);
    }));
  }

  /** Adds the overlay under every other object (regions stay on top). */
  attach(canvas: Canvas): void {
    canvas.insertAt(0, ...this.images);
  }

  detach(canvas: Canvas): void {
    canvas.remove(...this.images);
  }

  setVisible(visible: boolean): void {
    for (const image of this.images) image.visible = visible;
  }

  beginStroke(layer: MaskLayerName, point: { x: number; y: number }, size: number): void {
    const { width, height } = this.page;
    for (const name of PAINTED) {
      const snapshot = context(this.snapshots[name]);
      snapshot.clearRect(0, 0, width, height);
      snapshot.drawImage(this.layers[name], 0, 0);
    }
    this.stroke = { layer, size, last: point, minX: point.x, minY: point.y, maxX: point.x, maxY: point.y };
    this.paint(point, point);
  }

  strokeTo(point: { x: number; y: number }): void {
    const stroke = this.stroke;
    if (!stroke) return;
    this.paint(stroke.last, point);
    stroke.last = point;
    stroke.minX = Math.min(stroke.minX, point.x);
    stroke.minY = Math.min(stroke.minY, point.y);
    stroke.maxX = Math.max(stroke.maxX, point.x);
    stroke.maxY = Math.max(stroke.maxY, point.y);
  }

  /** Ends the stroke; null when it changed nothing (e.g. erasing where nothing was painted). */
  endStroke(): StrokeRecord | null {
    const stroke = this.stroke;
    if (!stroke) return null;
    this.stroke = null;
    const { width, height } = this.page;
    const pad = Math.ceil(stroke.size / 2) + 2;
    const x = clamp(Math.floor(stroke.minX - pad), 0, width - 1);
    const y = clamp(Math.floor(stroke.minY - pad), 0, height - 1);
    const area = {
      x,
      y,
      w: clamp(Math.ceil(stroke.maxX + pad) - x, 1, width - x),
      h: clamp(Math.ceil(stroke.maxY + pad) - y, 1, height - y),
    };
    const read = (canvas: HTMLCanvasElement) => context(canvas).getImageData(area.x, area.y, area.w, area.h);
    const before = { add: read(this.snapshots.add), erase: read(this.snapshots.erase) };
    const after = { add: read(this.layers.add), erase: read(this.layers.erase) };
    const touched = { add: !sameData(before.add, after.add), erase: !sameData(before.erase, after.erase) };
    if (!touched.add && !touched.erase) return null;
    return { layer: stroke.layer, area, before, after, touched };
  }

  /** Puts a stroke's painted layers back to how they were before or after it. */
  apply(record: StrokeRecord, state: "before" | "after"): void {
    for (const name of PAINTED) context(this.layers[name]).putImageData(record[state][name], record.area.x, record.area.y);
  }

  /** A painted layer as the server stores it: a page-size PNG data URL, white where painted on black. */
  exportLayer(name: MaskLayerName): string {
    const { width, height } = this.page;
    const out = pageCanvas(this.page);
    const ctx = context(out);
    ctx.drawImage(this.layers[name], 0, 0);
    ctx.globalCompositeOperation = "source-in";
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, width, height);
    ctx.globalCompositeOperation = "destination-over";
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, width, height);
    return out.toDataURL("image/png");
  }

  /** Draws one brush segment onto the stroke's layer and clears the same pixels from the other painted layer. */
  private paint(from: { x: number; y: number }, to: { x: number; y: number }): void {
    const stroke = this.stroke;
    if (!stroke) return;
    const draw = (ctx: CanvasRenderingContext2D, operation: GlobalCompositeOperation, color: string) => {
      ctx.save();
      ctx.globalCompositeOperation = operation;
      ctx.fillStyle = color;
      ctx.strokeStyle = color;
      ctx.lineWidth = stroke.size;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      // A zero-length line draws nothing in some browsers: a click paints a dot instead
      if (from.x === to.x && from.y === to.y) {
        ctx.arc(to.x, to.y, stroke.size / 2, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.moveTo(from.x, from.y);
        ctx.lineTo(to.x, to.y);
        ctx.stroke();
      }
      ctx.restore();
    };
    const other: MaskLayerName = stroke.layer === "add" ? "erase" : "add";
    draw(context(this.layers[stroke.layer]), "source-over", LAYER_COLORS[stroke.layer]);
    draw(context(this.layers[other]), "destination-out", "#000");
  }
}

const overlaps = (a: Area, b: Area): boolean => a.x <= b.x + b.w && b.x <= a.x + a.w && a.y <= b.y + b.h && b.y <= a.y + a.h;

const union = (a: Area, b: Area): Area => {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
};

/** Merges touching areas; more than `limit` separate areas become their single bounding box. */
export function mergeAreas(areas: Area[], limit = 50): Area[] {
  const boxes = areas.map((a) => ({ ...a }));
  let merged = true;
  while (merged) {
    merged = false;
    for (let i = 0; i < boxes.length && !merged; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        if (!overlaps(boxes[i], boxes[j])) continue;
        boxes[i] = union(boxes[i], boxes[j]);
        boxes.splice(j, 1);
        merged = true;
        break;
      }
    }
  }
  return boxes.length > limit ? [boxes.reduce(union)] : boxes;
}
