"""
FastAPI server for manga-ocr using Unix domain sockets

Endpoints:
- GET /health - Health check
- POST /scan - OCR image scan (accepts base64 or binary data)
"""

import base64
import os
from io import BytesIO
from typing import Optional

import uvicorn
from fastapi import FastAPI, HTTPException, UploadFile, File
from pydantic import BaseModel
from PIL import Image
from loguru import logger

from .ocr import MangaOcr


class ImageRequest(BaseModel):
    """Request model for base64 image data"""
    image: str  # Base64 encoded image
    format: Optional[str] = "auto"  # Image format hint (png, jpg, etc.)


class ScanResponse(BaseModel):
    """Response model for OCR scan"""
    status: str
    text: str
    image_size: tuple[int, int]


class HealthResponse(BaseModel):
    """Response model for health check"""
    status: str
    model_loaded: bool


# Initialize FastAPI app
app = FastAPI(
    title="Manga OCR Server",
    description="OCR server for Japanese manga using Unix domain sockets",
    version="1.0.0",
)

# Global OCR instance (initialized on startup)
ocr_instance: Optional[MangaOcr] = None


@app.on_event("startup")
async def startup_event():
    """Initialize OCR model on server startup"""
    global ocr_instance
    logger.info("🚀 Starting Manga OCR server...")
    logger.info("📦 Loading OCR model into memory (please wait)...")

    try:
        ocr_instance = MangaOcr(force_cpu=True)
        logger.success("✅ Server ready! Model loaded and accepting requests.")
        logger.info("")
        logger.info("📡 Available endpoints:")
        logger.info("   GET  /health      - Health check")
        logger.info("   POST /scan        - Scan image (base64 JSON)")
        logger.info("   POST /scan-upload - Scan image (file upload)")
    except Exception as e:
        logger.error(f"❌ Failed to load OCR model: {e}")
        raise


@app.get("/health", response_model=HealthResponse)
async def health_check():
    """
    Health check endpoint

    Returns:
        HealthResponse with server status and model state
    """
    return HealthResponse(
        status="healthy" if ocr_instance is not None else "unhealthy",
        model_loaded=ocr_instance is not None,
    )


@app.post("/scan", response_model=ScanResponse)
async def scan_image_base64(request: ImageRequest):
    """
    Scan image from base64 encoded data

    Args:
        request: ImageRequest with base64 encoded image

    Returns:
        ScanResponse with OCR text and image dimensions

    Raises:
        HTTPException: If OCR model not loaded or image processing fails
    """
    if ocr_instance is None:
        raise HTTPException(status_code=503, detail="OCR model not loaded")

    try:
        # Decode base64 image
        img_bytes = base64.b64decode(request.image)
        img = Image.open(BytesIO(img_bytes))

        logger.info(f"📷 Processing image: {img.size[0]}x{img.size[1]} pixels")

        # Run OCR
        text = ocr_instance(img)

        logger.success(f"✅ OCR completed: {text[:50]}...")

        return ScanResponse(
            status="success",
            text=text,
            image_size=(img.size[0], img.size[1]),
        )

    except base64.binascii.Error as e:
        logger.error(f"❌ Invalid base64 data: {e}")
        raise HTTPException(status_code=400, detail=f"Invalid base64 encoding: {e}")
    except Exception as e:
        logger.error(f"❌ OCR processing failed: {e}")
        raise HTTPException(status_code=500, detail=f"OCR processing error: {e}")


@app.post("/scan-upload", response_model=ScanResponse)
async def scan_image_upload(file: UploadFile = File(...)):
    """
    Scan image from file upload

    Args:
        file: Uploaded image file

    Returns:
        ScanResponse with OCR text and image dimensions

    Raises:
        HTTPException: If OCR model not loaded or image processing fails
    """
    if ocr_instance is None:
        raise HTTPException(status_code=503, detail="OCR model not loaded")

    try:
        # Read uploaded file
        img_bytes = await file.read()
        img = Image.open(BytesIO(img_bytes))

        logger.info(f"📷 Processing uploaded file: {file.filename} ({img.size[0]}x{img.size[1]} pixels)")

        # Run OCR
        text = ocr_instance(img)

        logger.success(f"✅ OCR completed: {text[:50]}...")

        return ScanResponse(
            status="success",
            text=text,
            image_size=(img.size[0], img.size[1]),
        )

    except Exception as e:
        logger.error(f"❌ OCR processing failed: {e}")
        raise HTTPException(status_code=500, detail=f"OCR processing error: {e}")


def start_server(socket_path: str = "/app/sock/manga-ocr.sock", log_level: str = "info"):
    """
    Start the FastAPI server on Unix domain socket

    Args:
        socket_path: Path to Unix domain socket
        log_level: Logging level (debug, info, warning, error)
    """
    # Ensure socket directory exists
    socket_dir = os.path.dirname(socket_path)
    os.makedirs(socket_dir, exist_ok=True)

    # Remove existing socket file if it exists
    if os.path.exists(socket_path):
        os.remove(socket_path)

    logger.info(f"🌐 Binding to Unix socket: {socket_path}")
    logger.info("⏳ Waiting for model to load before accepting requests...")

    try:
        # Start uvicorn with Unix domain socket
        uvicorn.run(
            app,
            uds=socket_path,
            log_level=log_level,
            access_log=True,
        )
    finally:
        # Cleanup socket on exit
        if os.path.exists(socket_path):
            os.remove(socket_path)
            logger.info(f"🧹 Cleaned up socket: {socket_path}")


if __name__ == "__main__":
    start_server()
