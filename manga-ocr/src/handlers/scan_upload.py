"""
OCR scan handler for file uploads.
"""

from io import BytesIO

from fastapi import HTTPException, UploadFile
from PIL import Image
from loguru import logger

from ..models import ScanResponse
from .. import state


async def scan_image_upload(file: UploadFile) -> ScanResponse:
    """
    Perform OCR on uploaded image file.

    Args:
        file: Uploaded image file

    Returns:
        ScanResponse with OCR text and image dimensions

    Raises:
        HTTPException: If OCR model not loaded or image processing fails
    """
    if state.ocr_instance is None:
        raise HTTPException(status_code=503, detail="OCR model not loaded")

    try:
        img_bytes = await file.read()
        img = Image.open(BytesIO(img_bytes))

        logger.info(f"Processing uploaded file: {file.filename} ({img.size[0]}x{img.size[1]} pixels)")

        text = state.ocr_instance(img)

        logger.success(f"OCR completed: {text[:50]}...")

        return ScanResponse(
            status="success",
            text=text,
            image_size=(img.size[0], img.size[1]),
        )
    except Exception as e:
        logger.error(f"OCR processing failed: {e}")
        raise HTTPException(status_code=500, detail=f"OCR processing error: {e}")
