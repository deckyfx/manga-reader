"""
Patch generation handler — cleans text region and renders translated text overlay.
"""

import cv2
import numpy as np
from fastapi import HTTPException
from PIL import Image, ImageDraw, ImageFont
from loguru import logger

from ..response_models import PatchRequest, PatchResponse
from .. import state
from ..utils import decode_base64_image, encode_image_to_base64
from ..patch_generator import clean_text_region
from ..patch_generator.text_cleaner import LamaCleaner
from ..patch_generator.text_renderer import render_text, hex_to_rgb, get_font_path


def _get_cleaner(threshold: int):
    """
    Get a text cleaner instance, optionally overriding threshold for LaMa.

    Args:
        threshold: Cleaner threshold (0-255)

    Returns:
        TextCleaner instance with the requested threshold
    """
    if state.cleaner_mode == "lama" and state.text_cleaner is not None and isinstance(state.text_cleaner, LamaCleaner):
        return LamaCleaner(model=state.text_cleaner.model, threshold=threshold)
    return state.text_cleaner


def _clean_image(image: np.ndarray, threshold: int) -> np.ndarray:
    """
    Clean text from image using the configured cleaner.

    Args:
        image: OpenCV BGR image
        threshold: Cleaner threshold (0-255)

    Returns:
        Cleaned OpenCV image
    """
    logger.info(f"Cleaning text (threshold={threshold})...")
    cleaner = _get_cleaner(threshold)
    return clean_text_region(image, cleaner=cleaner)


def _render_text_on_rgba(
    cleaned_image: np.ndarray,
    text: str,
    request: PatchRequest,
    width: int,
    height: int,
) -> str:
    """
    Render text on RGBA image and return base64 encoded result.

    Args:
        cleaned_image: RGBA image (numpy BGRA format)
        text: Multiline text to render
        request: PatchRequest with font/style options
        width: Image width
        height: Image height

    Returns:
        Base64 encoded PNG string
    """
    cleaned_rgba_pil = cv2.cvtColor(cleaned_image, cv2.COLOR_BGRA2RGBA)
    pil_image = Image.fromarray(cleaned_rgba_pil, mode="RGBA")

    font_path = get_font_path(request.fontType)
    try:
        font = ImageFont.truetype(font_path, request.fontSize)
    except Exception as e:
        logger.warning(f"Failed to load font {font_path}: {e}, using default")
        font = ImageFont.load_default()

    text_rgb = hex_to_rgb(request.textColor)
    stroke_rgb = hex_to_rgb(request.strokeColor) if request.strokeColor else None

    # Calculate polygon bounding box for text centering
    if request.polygonPoints:
        poly_points = [(int(round(p.x)), int(round(p.y))) for p in request.polygonPoints]
        poly_xs = [p[0] for p in poly_points]
        poly_ys = [p[1] for p in poly_points]
        center_x = (min(poly_xs) + max(poly_xs)) // 2
        center_y = (min(poly_ys) + max(poly_ys)) // 2
    else:
        center_x = width // 2
        center_y = height // 2

    draw = ImageDraw.Draw(pil_image)
    bbox = draw.multiline_textbbox((0, 0), text, font=font, spacing=4, align="center")
    text_width = bbox[2] - bbox[0]
    text_height = bbox[3] - bbox[1]
    text_x = center_x - text_width // 2
    text_y = center_y - text_height // 2

    # Draw stroke manually (offset rendering) to avoid PIL's built-in stroke
    # which inflates glyph bounds and increases effective line height
    if stroke_rgb and request.strokeWidth > 0:
        sw = request.strokeWidth
        for dx in range(-sw, sw + 1):
            for dy in range(-sw, sw + 1):
                if dx != 0 or dy != 0:
                    draw.multiline_text(
                        (text_x + dx, text_y + dy),
                        text,
                        font=font,
                        fill=(*stroke_rgb, 255),
                        spacing=4,
                        align="center",
                    )

    # Draw main text on top
    draw.multiline_text(
        (text_x, text_y),
        text,
        font=font,
        fill=(*text_rgb, 255),
        spacing=4,
        align="center",
    )

    result_np = np.array(pil_image)
    result_bgra = cv2.cvtColor(result_np, cv2.COLOR_RGBA2BGRA)
    return encode_image_to_base64(result_bgra, "png")


async def generate_patch(request: PatchRequest) -> PatchResponse:
    """
    Generate translation patch with cleaned background and rendered text.

    Args:
        request: PatchRequest with image, text, and styling options

    Returns:
        PatchResponse with base64 encoded patch image

    Raises:
        HTTPException: If processing fails
    """
    try:
        image = decode_base64_image(request.capturedImage)
        height, width = image.shape[:2]

        logger.info(f"Generating patch: {width}x{height} pixels")
        logger.info(f"   Font: {request.fontType} {request.fontSize}px, Color: {request.textColor}")
        logger.info(f"   Alpha background: {request.alphaBackground}")

        # Alpha background mode: skip cleaning, create transparent image
        if request.alphaBackground:
            logger.info("Alpha background mode: transparent image with text only")
            cleaned_image = np.zeros((height, width, 4), dtype=np.uint8)
        else:
            use_polygon_mask = (
                request.polygonPoints is not None
                and len(request.polygonPoints) >= 3
            )

            if use_polygon_mask:
                logger.info(f"Using polygon mask with {len(request.polygonPoints)} points")

                # Create polygon mask
                mask = np.zeros((height, width), dtype=np.uint8)
                pts = np.array(
                    [[int(round(p.x)), int(round(p.y))] for p in request.polygonPoints],
                    dtype=np.int32,
                )
                cv2.fillPoly(mask, [pts], 255)

                cleaned_image = _clean_image(image, request.cleanerThreshold)

                # Convert to RGBA with alpha channel from mask
                cleaned_rgba = cv2.cvtColor(cleaned_image, cv2.COLOR_BGR2BGRA)
                cleaned_rgba[:, :, 3] = mask
                cleaned_image = cleaned_rgba
            else:
                cleaned_image = _clean_image(image, request.cleanerThreshold)

        # Render translated text
        text_with_newlines = "\n".join(request.translatedText)
        logger.info(f"Rendering text: '{text_with_newlines[:50]}...'")

        if cleaned_image.shape[2] == 4:  # RGBA
            patch_base64 = _render_text_on_rgba(
                cleaned_image, text_with_newlines, request, width, height
            )
        else:
            # BGR image - use render_text
            result = render_text(
                cleaned_image,
                text_with_newlines,
                width,
                height,
                request.fontSize,
                request.fontType,
                request.textColor,
                request.strokeColor,
                request.strokeWidth,
            )
            patch_base64 = encode_image_to_base64(result, "png")

        logger.info(f"Patch generated: {len(patch_base64)} bytes")

        return PatchResponse(
            status="success",
            patchImage=patch_base64,
            size=[width, height],
        )

    except Exception as e:
        logger.error(f"Patch generation error: {e}")
        raise HTTPException(status_code=500, detail=f"Patch generation failed: {str(e)}")
