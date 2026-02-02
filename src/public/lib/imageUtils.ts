/**
 * Image coordinate and dimension utilities
 *
 * Handles coordinate transformations between displayed (scaled) image space
 * and natural (original) image resolution space.
 */

/**
 * Scale factors between displayed and natural image dimensions
 */
export interface ScaleFactors {
  scaleX: number;
  scaleY: number;
}

/**
 * Point coordinates
 */
export interface Point {
  x: number;
  y: number;
}

/**
 * Rectangle dimensions
 */
export interface Dimensions {
  width: number;
  height: number;
}

/**
 * Rectangle with position and dimensions
 */
export interface Rectangle extends Point, Dimensions {}

/**
 * Calculate scale factors between displayed and natural image dimensions
 *
 * @param displayedWidth - Width of the displayed (scaled) image in pixels
 * @param displayedHeight - Height of the displayed (scaled) image in pixels
 * @param naturalWidth - Width of the natural (original) image in pixels
 * @param naturalHeight - Height of the natural (original) image in pixels
 * @returns Scale factors for X and Y axes
 *
 * @example
 * // Image displayed at 500x700 but natural size is 1751x2472
 * const scale = getScaleFactors(500, 700, 1751, 2472);
 * // Returns: { scaleX: 3.502, scaleY: 3.531 }
 */
export function getScaleFactors(
  displayedWidth: number,
  displayedHeight: number,
  naturalWidth: number,
  naturalHeight: number
): ScaleFactors {
  return {
    scaleX: naturalWidth / displayedWidth,
    scaleY: naturalHeight / displayedHeight,
  };
}

/**
 * Scale a point from displayed coordinates to natural coordinates
 *
 * @param point - Point in displayed coordinate space
 * @param scale - Scale factors
 * @returns Point in natural coordinate space
 *
 * @example
 * const displayedPoint = { x: 435, y: 48 };
 * const scale = { scaleX: 3.502, scaleY: 3.531 };
 * const naturalPoint = scalePoint(displayedPoint, scale);
 * // Returns: { x: 1523.37, y: 169.49 }
 */
export function scalePoint(point: Point, scale: ScaleFactors): Point {
  return {
    x: point.x * scale.scaleX,
    y: point.y * scale.scaleY,
  };
}

/**
 * Scale dimensions from displayed size to natural size
 *
 * @param dimensions - Dimensions in displayed space
 * @param scale - Scale factors
 * @returns Dimensions in natural space
 *
 * @example
 * const displayedSize = { width: 200, height: 100 };
 * const scale = { scaleX: 3.502, scaleY: 3.531 };
 * const naturalSize = scaleDimensions(displayedSize, scale);
 * // Returns: { width: 700.4, height: 353.1 }
 */
export function scaleDimensions(
  dimensions: Dimensions,
  scale: ScaleFactors
): Dimensions {
  return {
    width: dimensions.width * scale.scaleX,
    height: dimensions.height * scale.scaleY,
  };
}

/**
 * Scale a rectangle from displayed coordinates to natural coordinates
 *
 * @param rect - Rectangle in displayed coordinate space
 * @param scale - Scale factors
 * @returns Rectangle in natural coordinate space
 *
 * @example
 * const displayedRect = { x: 435, y: 48, width: 200, height: 100 };
 * const scale = { scaleX: 3.502, scaleY: 3.531 };
 * const naturalRect = scaleRectangle(displayedRect, scale);
 * // Returns: { x: 1523.37, y: 169.49, width: 700.4, height: 353.1 }
 */
export function scaleRectangle(
  rect: Rectangle,
  scale: ScaleFactors
): Rectangle {
  return {
    x: rect.x * scale.scaleX,
    y: rect.y * scale.scaleY,
    width: rect.width * scale.scaleX,
    height: rect.height * scale.scaleY,
  };
}

/**
 * Get scale factors from an image element
 *
 * @param imageElement - HTML image element
 * @returns Scale factors between displayed and natural dimensions
 *
 * @example
 * const img = document.querySelector('img');
 * const scale = getImageScaleFactors(img);
 * // Returns: { scaleX: 3.502, scaleY: 3.531 }
 */
export function getImageScaleFactors(
  imageElement: HTMLImageElement
): ScaleFactors {
  // Use getBoundingClientRect() for accurate rendered dimensions
  const rect = imageElement.getBoundingClientRect();
  return getScaleFactors(
    rect.width,
    rect.height,
    imageElement.naturalWidth,
    imageElement.naturalHeight
  );
}

/**
 * Convert displayed rectangle to natural canvas coordinates
 *
 * Convenience function that combines getting scale factors and scaling the rectangle.
 *
 * @param rect - Rectangle in displayed coordinate space
 * @param imageElement - HTML image element for scale calculation
 * @returns Rectangle in natural coordinate space
 *
 * @example
 * const selection = { x: 435, y: 48, width: 200, height: 100 };
 * const img = document.querySelector('img');
 * const canvasRect = displayedToNaturalRect(selection, img);
 * // Returns scaled rectangle ready for canvas operations
 */
export function displayedToNaturalRect(
  rect: Rectangle,
  imageElement: HTMLImageElement
): Rectangle {
  const scale = getImageScaleFactors(imageElement);
  return scaleRectangle(rect, scale);
}

/**
 * Convert data URL to File object
 *
 * @param dataUrl - Data URL (e.g., from canvas.toDataURL())
 * @param filename - Name for the file
 * @returns Promise resolving to File object
 *
 * @example
 * const canvas = document.createElement('canvas');
 * // ... draw to canvas ...
 * const dataUrl = canvas.toDataURL('image/png');
 * const file = await dataUrlToFile(dataUrl, 'capture.png');
 * // Use file in FormData or API calls
 */
export async function dataUrlToFile(
  dataUrl: string,
  filename: string = "image.png"
): Promise<File> {
  const response = await fetch(dataUrl);
  const blob = await response.blob();
  return new File([blob], filename, { type: blob.type || "image/png" });
}
