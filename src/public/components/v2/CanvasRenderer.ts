interface Point {
  x: number;
  y: number;
}

export type HandleType = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

interface CaptionData {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  polygonPoints?: Point[];
  patchImagePath?: string;
}

export interface TransformPreview {
  x: number;
  y: number;
  width: number;
  height: number;
  polygonPoints?: Point[];
}

interface RectRenderData {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface PolyRenderData {
  points: Point[];
  cursorPos: Point | null;
}

interface OvalRenderData {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
}

/**
 * Pure canvas drawing functions for MangaPageV2.
 *
 * All coordinates are in image-pixel space (canvas internal resolution).
 * No DOM manipulation, no React — just CanvasRenderingContext2D calls.
 */
export class CanvasRenderer {
  /** Draw the base manga page image */
  static drawImage(ctx: CanvasRenderingContext2D, image: HTMLImageElement): void {
    ctx.drawImage(image, 0, 0);
  }

  /** Draw green highlight outlines for existing caption regions */
  static drawCaptionRegions(
    ctx: CanvasRenderingContext2D,
    captions: CaptionData[],
    activeCaptionId: string | null,
  ): void {
    for (const caption of captions) {
      const isActive = caption.id === activeCaptionId;

      ctx.save();
      ctx.lineWidth = isActive ? 3 : 2;
      ctx.strokeStyle = isActive ? "#22c55e" : "#4ade80"; // green-500 / green-400
      ctx.fillStyle = isActive
        ? "rgba(34, 197, 94, 0.15)"
        : "rgba(74, 222, 128, 0.08)";

      if (caption.polygonPoints && caption.polygonPoints.length >= 3) {
        const pts = caption.polygonPoints;
        ctx.beginPath();
        ctx.moveTo(pts[0]!.x, pts[0]!.y);
        for (let i = 1; i < pts.length; i++) {
          ctx.lineTo(pts[i]!.x, pts[i]!.y);
        }
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      } else {
        ctx.fillRect(caption.x, caption.y, caption.width, caption.height);
        ctx.strokeRect(caption.x, caption.y, caption.width, caption.height);
      }

      ctx.restore();
    }
  }

  /** Draw the live drawing preview (rectangle, polygon, or oval being drawn) */
  static drawDrawingPreview(
    ctx: CanvasRenderingContext2D,
    toolType: "none" | "rectangle" | "polygon" | "oval",
    rectData: RectRenderData | null,
    polyData: PolyRenderData | null,
    ovalData: OvalRenderData | null = null,
  ): void {
    if (toolType === "rectangle" && rectData) {
      ctx.save();
      ctx.strokeStyle = "#3b82f6"; // blue-500
      ctx.fillStyle = "rgba(59, 130, 246, 0.2)";
      ctx.lineWidth = 2;
      ctx.fillRect(rectData.x, rectData.y, rectData.width, rectData.height);
      ctx.strokeRect(rectData.x, rectData.y, rectData.width, rectData.height);
      ctx.restore();
    }

    if (toolType === "polygon" && polyData && polyData.points.length > 0) {
      const pts = polyData.points;

      ctx.save();

      // Filled polygon (3+ points)
      if (pts.length >= 3) {
        ctx.beginPath();
        ctx.moveTo(pts[0]!.x, pts[0]!.y);
        for (let i = 1; i < pts.length; i++) {
          ctx.lineTo(pts[i]!.x, pts[i]!.y);
        }
        ctx.closePath();
        ctx.fillStyle = "rgba(147, 51, 234, 0.3)";
        ctx.fill();
        ctx.strokeStyle = "#9333ea"; // purple-600
        ctx.lineWidth = 2;
        ctx.stroke();
      } else if (pts.length >= 2) {
        // Connecting lines (2 points)
        ctx.beginPath();
        ctx.moveTo(pts[0]!.x, pts[0]!.y);
        for (let i = 1; i < pts.length; i++) {
          ctx.lineTo(pts[i]!.x, pts[i]!.y);
        }
        ctx.strokeStyle = "#9333ea";
        ctx.lineWidth = 2;
        ctx.stroke();
      }

      // Preview line from last point to cursor
      if (polyData.cursorPos && pts.length > 0) {
        const lastPt = pts[pts.length - 1]!;
        ctx.beginPath();
        ctx.moveTo(lastPt.x, lastPt.y);
        ctx.lineTo(polyData.cursorPos.x, polyData.cursorPos.y);
        ctx.strokeStyle = "#9333ea";
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 5]);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // Draw points
      for (let i = 0; i < pts.length; i++) {
        const pt = pts[i]!;

        // Filled circle
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, 6, 0, Math.PI * 2);
        ctx.fillStyle = "#9333ea";
        ctx.fill();
        ctx.strokeStyle = "white";
        ctx.lineWidth = 2;
        ctx.stroke();

        // Double ring for first point
        if (i === 0) {
          ctx.beginPath();
          ctx.arc(pt.x, pt.y, 9, 0, Math.PI * 2);
          ctx.strokeStyle = "#9333ea";
          ctx.lineWidth = 2;
          ctx.stroke();
        }
      }

      ctx.restore();
    }

    if (toolType === "oval" && ovalData && ovalData.rx > 0 && ovalData.ry > 0) {
      ctx.save();
      ctx.strokeStyle = "#06b6d4"; // cyan-500
      ctx.fillStyle = "rgba(6, 182, 212, 0.2)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(ovalData.cx, ovalData.cy, ovalData.rx, ovalData.ry, 0, 0, 2 * Math.PI);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
  }

  /** Get the 8 resize handle positions for a caption's bounding box */
  static getHandlePositions(
    caption: CaptionData,
  ): Record<HandleType, Point> {
    const { x, y, width, height } = caption;
    const mx = x + width / 2;
    const my = y + height / 2;
    return {
      nw: { x, y },
      n: { x: mx, y },
      ne: { x: x + width, y },
      e: { x: x + width, y: my },
      se: { x: x + width, y: y + height },
      s: { x: mx, y: y + height },
      sw: { x, y: y + height },
      w: { x, y: my },
    };
  }

  /** Hit-test against resize handles. Returns handle type or null. */
  static hitTestHandle(
    mx: number,
    my: number,
    caption: CaptionData,
    tolerance = 10,
  ): HandleType | null {
    const handles = CanvasRenderer.getHandlePositions(caption);
    const entries = Object.entries(handles) as [HandleType, Point][];
    for (const [type, pos] of entries) {
      const dx = mx - pos.x;
      const dy = my - pos.y;
      if (dx * dx + dy * dy <= tolerance * tolerance) {
        return type;
      }
    }
    return null;
  }

  /** Draw 8 resize handles on the selected caption */
  static drawResizeHandles(
    ctx: CanvasRenderingContext2D,
    caption: CaptionData,
  ): void {
    const handles = CanvasRenderer.getHandlePositions(caption);
    const size = 6;
    const half = size / 2;

    ctx.save();
    ctx.fillStyle = "#ffffff";
    ctx.strokeStyle = "#374151"; // gray-700
    ctx.lineWidth = 1.5;

    for (const pos of Object.values(handles)) {
      ctx.fillRect(pos.x - half, pos.y - half, size, size);
      ctx.strokeRect(pos.x - half, pos.y - half, size, size);
    }

    ctx.restore();
  }

  /** Map a handle type to a CSS cursor string */
  static getCursorForHandle(handle: HandleType | null): string {
    if (handle === null) return "move";
    const map: Record<HandleType, string> = {
      nw: "nwse-resize",
      se: "nwse-resize",
      ne: "nesw-resize",
      sw: "nesw-resize",
      n: "ns-resize",
      s: "ns-resize",
      e: "ew-resize",
      w: "ew-resize",
    };
    return map[handle];
  }

  /** Draw a dashed-outline preview of a region being transformed */
  static drawTransformPreview(
    ctx: CanvasRenderingContext2D,
    preview: TransformPreview,
  ): void {
    ctx.save();
    ctx.strokeStyle = "#f59e0b"; // amber-500
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);

    if (preview.polygonPoints && preview.polygonPoints.length >= 3) {
      const pts = preview.polygonPoints;
      ctx.beginPath();
      ctx.moveTo(pts[0]!.x, pts[0]!.y);
      for (let i = 1; i < pts.length; i++) {
        ctx.lineTo(pts[i]!.x, pts[i]!.y);
      }
      ctx.closePath();
      ctx.fillStyle = "rgba(245, 158, 11, 0.1)";
      ctx.fill();
      ctx.stroke();
    } else {
      ctx.fillStyle = "rgba(245, 158, 11, 0.1)";
      ctx.fillRect(preview.x, preview.y, preview.width, preview.height);
      ctx.strokeRect(preview.x, preview.y, preview.width, preview.height);
    }

    ctx.setLineDash([]);
    ctx.restore();
  }

  /** Draw loaded patch images on top of their caption regions */
  static drawPatchOverlays(
    ctx: CanvasRenderingContext2D,
    captions: CaptionData[],
    patchImages: Map<string, HTMLImageElement>,
  ): void {
    for (const caption of captions) {
      if (!caption.patchImagePath) continue;
      const img = patchImages.get(caption.id);
      if (!img || !img.complete) continue;

      ctx.save();

      if (caption.polygonPoints && caption.polygonPoints.length >= 3) {
        const pts = caption.polygonPoints;
        const path = new Path2D();
        path.moveTo(pts[0]!.x, pts[0]!.y);
        for (let i = 1; i < pts.length; i++) {
          path.lineTo(pts[i]!.x, pts[i]!.y);
        }
        path.closePath();
        ctx.clip(path);
      }

      ctx.drawImage(img, caption.x, caption.y, caption.width, caption.height);
      ctx.restore();
    }
  }

  /**
   * Full-frame redraw: clear, draw image, draw patch overlays, draw caption highlights,
   * draw drawing preview, draw transform preview + resize handles.
   */
  static redraw(
    ctx: CanvasRenderingContext2D,
    image: HTMLImageElement,
    captions: CaptionData[],
    activeCaptionId: string | null,
    toolType: "none" | "rectangle" | "polygon" | "oval",
    rectData: RectRenderData | null,
    polyData: PolyRenderData | null,
    patchImages?: Map<string, HTMLImageElement>,
    ovalData: OvalRenderData | null = null,
    transformPreview: TransformPreview | null = null,
  ): void {
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    CanvasRenderer.drawImage(ctx, image);
    if (patchImages && patchImages.size > 0) {
      CanvasRenderer.drawPatchOverlays(ctx, captions, patchImages);
    }
    CanvasRenderer.drawCaptionRegions(ctx, captions, activeCaptionId);
    CanvasRenderer.drawDrawingPreview(ctx, toolType, rectData, polyData, ovalData);

    // Draw transform preview (dashed outline during drag/resize)
    if (transformPreview) {
      CanvasRenderer.drawTransformPreview(ctx, transformPreview);
    }

    // Draw resize handles on selected caption when no drawing tool active
    if (toolType === "none" && activeCaptionId) {
      const activeCaption = captions.find((c) => c.id === activeCaptionId);
      if (activeCaption) {
        CanvasRenderer.drawResizeHandles(ctx, activeCaption);
      }
    }
  }

  /**
   * Hit-test: check if image-pixel (x, y) falls inside any caption region.
   * Returns the caption ID or null.
   */
  static hitTestCaption(
    x: number,
    y: number,
    captions: CaptionData[],
  ): string | null {
    // Iterate in reverse so topmost (last-drawn) captions take priority
    for (let i = captions.length - 1; i >= 0; i--) {
      const c = captions[i]!;

      if (c.polygonPoints && c.polygonPoints.length >= 3) {
        if (CanvasRenderer.pointInPolygon(x, y, c.polygonPoints)) {
          return c.id;
        }
      } else {
        if (
          x >= c.x &&
          x <= c.x + c.width &&
          y >= c.y &&
          y <= c.y + c.height
        ) {
          return c.id;
        }
      }
    }
    return null;
  }

  /**
   * Capture a rectangular region from the canvas as a data URL.
   * Optionally clips to a polygon shape within that rectangle.
   */
  static captureRegion(
    canvas: HTMLCanvasElement,
    x: number,
    y: number,
    w: number,
    h: number,
    polygonPoints?: Point[],
  ): string | null {
    const roundedX = Math.round(x);
    const roundedY = Math.round(y);
    const roundedW = Math.round(w);
    const roundedH = Math.round(h);

    if (roundedW <= 0 || roundedH <= 0) return null;

    const temp = document.createElement("canvas");
    temp.width = roundedW;
    temp.height = roundedH;
    const ctx = temp.getContext("2d");
    if (!ctx) return null;

    if (polygonPoints && polygonPoints.length >= 3) {
      const path = new Path2D();
      const rel = polygonPoints.map((p) => ({
        x: p.x - roundedX,
        y: p.y - roundedY,
      }));
      path.moveTo(rel[0]!.x, rel[0]!.y);
      for (let i = 1; i < rel.length; i++) {
        path.lineTo(rel[i]!.x, rel[i]!.y);
      }
      path.closePath();
      ctx.clip(path);
    }

    ctx.drawImage(
      canvas,
      roundedX,
      roundedY,
      roundedW,
      roundedH,
      0,
      0,
      roundedW,
      roundedH,
    );

    return temp.toDataURL("image/png");
  }

  /** Ray-casting point-in-polygon test */
  private static pointInPolygon(
    x: number,
    y: number,
    polygon: Point[],
  ): boolean {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const xi = polygon[i]!.x;
      const yi = polygon[i]!.y;
      const xj = polygon[j]!.x;
      const yj = polygon[j]!.y;

      const intersect =
        yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
      if (intersect) inside = !inside;
    }
    return inside;
  }
}
