/**
 * Shared region types for caption coordinate storage.
 *
 * Used by both backend (DB serialization) and frontend (canvas rendering).
 * Discriminated union on `shape` field for extensibility.
 */

export interface Point {
  x: number;
  y: number;
}

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type Region =
  | { shape: "rectangle"; data: BoundingBox }
  | { shape: "polygon"; data: BoundingBox & { points: Point[] } }
  | { shape: "oval"; data: BoundingBox };

/**
 * Extract the bounding box from any region shape.
 * All shapes store x, y, width, height in `data`.
 */
export function getRegionBounds(region: Region): BoundingBox {
  return {
    x: region.data.x,
    y: region.data.y,
    width: region.data.width,
    height: region.data.height,
  };
}

/**
 * Get polygon points for a region.
 *
 * - rectangle: returns undefined (rendered as rect)
 * - polygon: returns stored points
 * - oval: generates ellipse points on-the-fly via parametric formula
 */
export function getRegionPolygonPoints(region: Region): Point[] | undefined {
  switch (region.shape) {
    case "rectangle":
      return undefined;
    case "polygon":
      return region.data.points;
    case "oval":
      return generateEllipsePoints(
        region.data.x,
        region.data.y,
        region.data.width,
        region.data.height,
      );
  }
}

/**
 * Generate polygon points approximating an ellipse inscribed in the given bounding box.
 *
 * Uses parametric formula: cx + rx*cos(theta), cy + ry*sin(theta)
 *
 * @param x - Bounding box left
 * @param y - Bounding box top
 * @param w - Bounding box width
 * @param h - Bounding box height
 * @param n - Number of points (default 32)
 */
export function generateEllipsePoints(
  x: number,
  y: number,
  w: number,
  h: number,
  n = 32,
): Point[] {
  const cx = x + w / 2;
  const cy = y + h / 2;
  const rx = w / 2;
  const ry = h / 2;
  const points: Point[] = [];

  for (let i = 0; i < n; i++) {
    const angle = (2 * Math.PI * i) / n;
    points.push({
      x: cx + rx * Math.cos(angle),
      y: cy + ry * Math.sin(angle),
    });
  }

  return points;
}
