"""Mask-based inpainting handler using AnimeLaMa."""

import cv2
import numpy as np
from fastapi import HTTPException, UploadFile
from loguru import logger

from ..response_models import InpaintMaskResponse
from .. import state
from ..utils import encode_image_to_base64


async def inpaint_mask(
    image_file: UploadFile,
    mask_file: UploadFile,
) -> InpaintMaskResponse:
    """
    Inpaint page image using binary mask.

    Args:
        image_file: Page image file
        mask_file: Binary mask PNG (white=inpaint, black=preserve)

    Returns:
        InpaintMaskResponse with cleaned page image

    Raises:
        HTTPException: If models not ready or processing fails
    """
    # Check model readiness
    if not state.animelama_ready or state.animelama_instance is None:
        raise HTTPException(503, "AnimeLaMa model not ready")

    try:
        # Load image
        image_bytes = await image_file.read()
        image_np = np.frombuffer(image_bytes, dtype=np.uint8)
        image = cv2.imdecode(image_np, cv2.IMREAD_COLOR)

        if image is None:
            raise ValueError("Failed to decode image")

        # Load mask
        mask_bytes = await mask_file.read()
        mask_np = np.frombuffer(mask_bytes, dtype=np.uint8)
        mask = cv2.imdecode(mask_np, cv2.IMREAD_GRAYSCALE)

        if mask is None:
            raise ValueError("Failed to decode mask")

        logger.info(f"Inpainting image: {image.shape[:2]}, mask: {mask.shape[:2]}")

        # Convert BGR to RGB for AnimeLaMa
        image_rgb = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)

        # Inpaint with AnimeLaMa
        cleaned = state.animelama_instance.inpaint(image_rgb, mask)

        # Encode to base64
        cleaned_base64 = encode_image_to_base64(cleaned, "png")

        logger.info("Inpainting completed successfully")

        return InpaintMaskResponse(
            status="success",
            cleanedImage=cleaned_base64,
        )

    except Exception as e:
        logger.error(f"Inpainting error: {e}")
        raise HTTPException(500, f"Inpainting failed: {str(e)}")
