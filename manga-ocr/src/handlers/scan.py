"""
OCR scan handler for base64 encoded images.
"""

import base64
from io import BytesIO

from fastapi import HTTPException
from PIL import Image
from loguru import logger

from ..models import ImageRequest, ScanResponse
from .. import state


async def scan_image_base64(request: ImageRequest) -> ScanResponse:
    """
    Perform OCR on base64 encoded image.

    Args:
        request: ImageRequest with base64 image

    Returns:
        ScanResponse with extracted text

    Raises:
        HTTPException: If OCR model not ready or processing fails
    """
    if not state.ocr_instance:
        raise HTTPException(status_code=503, detail="OCR model not ready")

    try:
        img_bytes = base64.b64decode(request.image)
        img = Image.open(BytesIO(img_bytes))

        text = state.ocr_instance(img)

        return ScanResponse(
            status="success",
            text=text,
            image_size=(img.width, img.height),
        )
    except Exception as e:
        logger.error(f"OCR error: {e}")
        raise HTTPException(status_code=500, detail=f"OCR failed: {str(e)}")
