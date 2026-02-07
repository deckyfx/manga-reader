"""
Text Cleaner Module

Provides text removal from manga image regions via pluggable cleaner strategies:
- OpenCVCleaner: Fast threshold + cv2.inpaint (TELEA)
- LamaCleaner: AI-based inpainting using Er0mangaInpaint (FFCResNetGenerator)

Both implement the TextCleaner protocol. Use create_cleaner() factory to instantiate.
"""

from __future__ import annotations

import cv2
import numpy as np
from loguru import logger
from PIL import Image
from typing import Protocol, TYPE_CHECKING

if TYPE_CHECKING:
    from .lama import SimpleLama


class TextCleaner(Protocol):
    """Protocol for text cleaning strategies."""

    def clean(self, image: np.ndarray) -> np.ndarray:
        """
        Remove text from a manga image region.

        Args:
            image: Input image as numpy array (BGR format from cv2)

        Returns:
            Cleaned image with text removed (BGR format)
        """
        ...


class OpenCVCleaner:
    """
    Text cleaning using OpenCV inpainting (fast, lower quality).

    Algorithm:
    1. Convert to grayscale
    2. Binary threshold to detect text (black pixels on light background)
    3. Dilate mask to expand text regions
    4. cv2.inpaint (TELEA) to fill with surrounding texture
    """

    def __init__(self, threshold: int = 180, dilate_iters: int = 1, inpaint_radius: int = 3):
        self.threshold = threshold
        self.dilate_iters = dilate_iters
        self.inpaint_radius = inpaint_radius

    def clean(self, image: np.ndarray) -> np.ndarray:
        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        _, mask = cv2.threshold(gray, self.threshold, 255, cv2.THRESH_BINARY_INV)
        kernel = np.ones((3, 3), np.uint8)
        mask = cv2.dilate(mask, kernel, iterations=self.dilate_iters)
        return cv2.inpaint(image, mask, inpaintRadius=self.inpaint_radius, flags=cv2.INPAINT_TELEA)


class LamaCleaner:
    """
    Text cleaning using Er0mangaInpaint AI inpainting.

    Algorithm:
    1. Detect text pixels via adaptive threshold + edge detection
    2. Convert BGR→RGB PIL for model input
    3. Run Er0mangaInpaint inference
    4. Convert result back to BGR
    """

    def __init__(self, model: SimpleLama, threshold: int = 200, dilate_iters: int = 2):
        self.model = model
        self.threshold = threshold
        self.dilate_iters = dilate_iters

    def clean(self, image: np.ndarray) -> np.ndarray:
        import time
        orig_h, orig_w = image.shape[:2]
        logger.info(f"🤖 LamaCleaner.clean() — {orig_w}x{orig_h} region")

        # Create text mask
        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        
        # Adaptive threshold
        adaptive_mask = cv2.adaptiveThreshold(
            gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, 
            cv2.THRESH_BINARY_INV, 11, 2
        )
        
        # Global threshold
        _, global_mask = cv2.threshold(gray, self.threshold, 255, cv2.THRESH_BINARY_INV)
        
        # Edge detection
        edges = cv2.Canny(gray, 50, 150)
        
        # Combine
        mask = cv2.bitwise_or(adaptive_mask, global_mask)
        mask = cv2.bitwise_or(mask, edges)
        
        # Clean up
        kernel = np.ones((3, 3), np.uint8)
        mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel, iterations=2)
        mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel, iterations=1)
        mask = cv2.dilate(mask, kernel, iterations=self.dilate_iters)

        mask_coverage = (mask > 0).sum() / mask.size * 100
        logger.info(f"🤖 Mask coverage: {mask_coverage:.1f}% of region")

        # Convert to PIL for model
        pil_image = Image.fromarray(cv2.cvtColor(image, cv2.COLOR_BGR2RGB))
        pil_mask = Image.fromarray(mask, mode="L")

        # Save debug images
        pil_image.save("/app/debug_input.png")
        pil_mask.save("/app/debug_mask.png")

        # Run Er0mangaInpaint inference
        t0 = time.monotonic()
        result = self.model(pil_image, pil_mask)
        elapsed = time.monotonic() - t0
        logger.info(f"🤖 Er0mangaInpaint inference: {elapsed*1000:.0f}ms")

        # Save output for debugging
        result.save("/app/debug_output.png")

        # Convert back to BGR numpy, crop to original size
        result_np = cv2.cvtColor(np.array(result), cv2.COLOR_RGB2BGR)
        return result_np[:orig_h, :orig_w]


def create_cleaner(mode: str = "opencv", lama_model: SimpleLama | None = None) -> TextCleaner:
    """
    Factory: create text cleaner instance based on mode.

    Args:
        mode: "lama" for AI inpainting, "opencv" for fast traditional inpainting
        lama_model: Required when mode="lama" — a loaded SimpleLama instance

    Returns:
        TextCleaner implementation
    """
    if mode == "lama" and lama_model is not None:
        return LamaCleaner(model=lama_model)
    return OpenCVCleaner()


# ── Backwards-compatible wrapper ──────────────────────────────────


def clean_text_region(image: np.ndarray, cleaner: TextCleaner | None = None) -> np.ndarray:
    """
    Remove text from manga image region using configured cleaner.

    Backwards-compatible: if no cleaner is passed, falls back to OpenCV.

    Args:
        image: Input image as numpy array (BGR format from cv2)
        cleaner: Optional TextCleaner instance (OpenCVCleaner or LamaCleaner)

    Returns:
        Cleaned image with text removed (BGR format)
    """
    if cleaner is None:
        cleaner = OpenCVCleaner()
    return cleaner.clean(image)


def clean_text_region_advanced(
    image: np.ndarray,
    threshold_value: int = 180,
    dilate_iterations: int = 1,
    inpaint_radius: int = 3,
) -> tuple[np.ndarray, np.ndarray]:
    """
    Advanced text cleaning with configurable parameters (OpenCV only).

    Args:
        image: Input image as numpy array (BGR format)
        threshold_value: Threshold for text detection (0-255)
        dilate_iterations: Number of dilation iterations
        inpaint_radius: Inpainting radius

    Returns:
        Tuple of (cleaned_image, mask)
    """
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    _, mask = cv2.threshold(gray, threshold_value, 255, cv2.THRESH_BINARY_INV)
    kernel = np.ones((3, 3), np.uint8)
    mask = cv2.dilate(mask, kernel, iterations=dilate_iterations)
    cleaned = cv2.inpaint(image, mask, inpaintRadius=inpaint_radius, flags=cv2.INPAINT_TELEA)
    return cleaned, mask
