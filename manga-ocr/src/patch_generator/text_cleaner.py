"""
Text Cleaner Module

OpenCV-based text removal from manga image regions using threshold and inpainting.
"""

import cv2
import numpy as np


def clean_text_region(image: np.ndarray) -> np.ndarray:
    """
    Remove text from manga image region using OpenCV inpainting

    Algorithm:
    1. Convert to grayscale
    2. Binary threshold to detect text (black pixels)
    3. Dilate mask to slightly expand text regions
    4. Inpaint to fill text with background texture

    Args:
        image: Input image as numpy array (BGR format from cv2)

    Returns:
        Cleaned image with text removed (BGR format)

    Example:
        >>> image = cv2.imread("manga_region.png")
        >>> cleaned = clean_text_region(image)
        >>> cv2.imwrite("cleaned.png", cleaned)
    """
    # Convert to grayscale for text detection
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)

    # Binary threshold: detect dark text on light background
    # Threshold value 180 works well for typical manga (white bg, black text)
    _, mask = cv2.threshold(gray, 180, 255, cv2.THRESH_BINARY_INV)

    # Dilate mask to expand text regions slightly
    # This ensures we capture the full text including anti-aliasing
    kernel = np.ones((3, 3), np.uint8)
    mask = cv2.dilate(mask, kernel, iterations=1)

    # Inpaint: fill masked regions with surrounding texture
    # INPAINT_TELEA: Fast marching method, good for manga
    # Radius 3: balance between speed and quality
    cleaned = cv2.inpaint(image, mask, inpaintRadius=3, flags=cv2.INPAINT_TELEA)

    return cleaned


def clean_text_region_advanced(
    image: np.ndarray,
    threshold_value: int = 180,
    dilate_iterations: int = 1,
    inpaint_radius: int = 3,
) -> tuple[np.ndarray, np.ndarray]:
    """
    Advanced text cleaning with configurable parameters

    Args:
        image: Input image as numpy array (BGR format)
        threshold_value: Threshold for text detection (0-255, lower = more aggressive)
        dilate_iterations: Number of dilation iterations (more = wider removal)
        inpaint_radius: Inpainting radius (larger = smoother but slower)

    Returns:
        Tuple of (cleaned_image, mask) for inspection

    Example:
        >>> image = cv2.imread("manga_region.png")
        >>> cleaned, mask = clean_text_region_advanced(image, threshold_value=170)
        >>> cv2.imwrite("cleaned.png", cleaned)
        >>> cv2.imwrite("mask.png", mask)
    """
    # Convert to grayscale
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)

    # Binary threshold with custom value
    _, mask = cv2.threshold(gray, threshold_value, 255, cv2.THRESH_BINARY_INV)

    # Dilate mask with custom iterations
    kernel = np.ones((3, 3), np.uint8)
    mask = cv2.dilate(mask, kernel, iterations=dilate_iterations)

    # Inpaint with custom radius
    cleaned = cv2.inpaint(image, mask, inpaintRadius=inpaint_radius, flags=cv2.INPAINT_TELEA)

    return cleaned, mask
