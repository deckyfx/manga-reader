"""
FastAPI server for manga-ocr using Unix domain sockets

Endpoints:
- GET /health - Health check
- POST /scan - OCR image scan (accepts base64 or binary data)
"""

# Build identifier - update this timestamp before building to verify new image
BUILD_ID = "2026-02-06_07:30:00_merge_patches"

import base64
import os
import tomllib
from pathlib import Path
from contextlib import asynccontextmanager
from io import BytesIO
from typing import Optional

import cv2
import numpy as np
import uvicorn
from fastapi import FastAPI, HTTPException, UploadFile, File
from pydantic import BaseModel
from PIL import Image
from loguru import logger

from .ocr import MangaOcr
from .patch_generator import clean_text_region
from .patch_generator.text_renderer import render_text

# Locate the pyproject.toml relative to this file
def get_project_metadata():
    path = Path(__file__).parent.parent / "pyproject.toml"
    try:
        with open(path, "rb") as f:
            data = tomllib.load(f)
            return data.get("project", {})
    except FileNotFoundError:
        return {"title": "Manga OCR", "version": "0.0.0", "description": ""}


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


class PatchRequest(BaseModel):
    """Request model for patch generation"""
    capturedImage: str  # Base64 encoded image (dimensions auto-detected)
    translatedText: list[str]  # Array of text lines (will be joined with newlines)
    fontSize: int = 24  # Font size in pixels
    fontType: str = "regular"  # Font type: regular, bold, italic
    textColor: str = "#000000"  # Text color in hex (e.g., #000000 for black)
    strokeColor: str | None = None  # Stroke color in hex (None for no stroke)
    strokeWidth: int = 0  # Stroke width in pixels (0 for no stroke)


class PatchResponse(BaseModel):
    """Response model for patch generation"""
    status: str
    patchImage: str  # Base64 encoded PNG
    size: list[int]  # [width, height]


class PatchOverlay(BaseModel):
    """Single patch to overlay on page"""
    patchImageBase64: str  # Base64 encoded patch image
    x: float  # X position on page
    y: float  # Y position on page
    width: int  # Target width (will resize patch to this)
    height: int  # Target height (will resize patch to this)


class MergePatchesRequest(BaseModel):
    """Request model for merging patches onto page image"""
    pageImageBase64: str  # Base64 encoded original page image
    patches: list[PatchOverlay]  # List of patches with positions


class MergePatchesResponse(BaseModel):
    """Response model for merge patches"""
    status: str
    mergedImage: str  # Base64 encoded merged image


# Global OCR instance (initialized on startup)
ocr_instance: Optional[MangaOcr] = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Lifespan context manager for FastAPI app
    Handles startup and shutdown events
    """
    # Startup: Initialize OCR model
    global ocr_instance
    logger.info("🚀 Starting Manga OCR server...")
    logger.info(f"🏷️  Build ID: {BUILD_ID}")
    logger.info("📦 Loading OCR model into memory (please wait)...")

    try:
        ocr_instance = MangaOcr(force_cpu=True)
        logger.success("✅ Server ready! Model loaded and accepting requests.")
        logger.info("")
        logger.info("📡 Available endpoints:")
        logger.info("   GET  /health           - Health check")
        logger.info("   POST /scan             - Scan image (base64 JSON)")
        logger.info("   POST /scan-upload      - Scan image (file upload)")
        logger.info("   POST /generate-patch   - Generate translation patch")
        logger.info("   POST /merge-patches    - Merge patches onto page")
    except Exception as e:
        logger.error(f"❌ Failed to load OCR model: {e}")
        raise

    yield

    # Shutdown: Cleanup (if needed in future)
    logger.info("👋 Shutting down Manga OCR server...")


meta = get_project_metadata()

# Initialize FastAPI app with lifespan
app = FastAPI(
    title=meta.get("name", "Manga OCR Server"),
    description=meta.get("description", "OCR server for Japanese manga"),
    version=meta.get("version", "0.0.5"),
    lifespan=lifespan,
)


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


@app.post("/generate-patch", response_model=PatchResponse)
async def generate_patch(request: PatchRequest):
    """
    Generate patch image with translated text overlay (manual control)

    User provides:
    - Image (dimensions auto-detected)
    - Array of text lines (joined with newlines)
    - Font size
    - Font type (regular, bold, italic)
    - Text color (hex)
    - Stroke color (hex) and width

    Process:
    1. Decode base64 image and auto-detect dimensions
    2. Clean text from region using OpenCV inpainting
    3. Join text lines with newlines
    4. Render translated text with user-specified settings (centered)
    5. Return as base64 encoded PNG

    Args:
        request: PatchRequest with image, text array, and styling (no dimensions needed)

    Returns:
        PatchResponse with generated patch image and auto-detected dimensions

    Raises:
        HTTPException: If image processing fails
    """
    try:
        # Decode base64 image
        image_bytes = base64.b64decode(request.capturedImage)
        nparr = np.frombuffer(image_bytes, np.uint8)
        image = cv2.imdecode(nparr, cv2.IMREAD_COLOR)

        if image is None:
            raise ValueError("Failed to decode image")

        # Get dimensions from image
        height, width = image.shape[:2]
        logger.info(f"🖼️  Generating patch: {width}x{height} pixels (auto-detected)")
        logger.info(f"   Font: {request.fontType} {request.fontSize}px, Color: {request.textColor}")

        # Step 1: Clean text from region
        logger.info("🧹 Cleaning text from region...")
        cleaned_image = clean_text_region(image)

        # Step 2: Render translated text with manual settings
        # Join array of lines with newlines
        text_with_newlines = "\n".join(request.translatedText)
        logger.info(f"✍️  Rendering text: '{text_with_newlines[:50]}...'")
        patch_image = render_text(
            cleaned_image,
            text_with_newlines,
            width,  # Use auto-detected width
            height,  # Use auto-detected height
            font_size=request.fontSize,
            font_type=request.fontType,
            text_color=request.textColor,
            stroke_color=request.strokeColor,
            stroke_width=request.strokeWidth,
        )

        # Step 3: Encode as PNG
        success, buffer = cv2.imencode(".png", patch_image)
        if not success:
            raise ValueError("Failed to encode patch image as PNG")

        # Step 4: Convert to base64
        patch_base64 = base64.b64encode(buffer).decode("utf-8")

        logger.success(f"✅ Patch generated successfully ({len(patch_base64)} bytes)")

        return PatchResponse(
            status="success",
            patchImage=patch_base64,
            size=[width, height],  # Return auto-detected dimensions
        )

    except base64.binascii.Error as e:
        logger.error(f"❌ Invalid base64 data: {e}")
        raise HTTPException(status_code=400, detail=f"Invalid base64 encoding: {e}")
    except Exception as e:
        logger.error(f"❌ Patch generation failed: {e}")
        raise HTTPException(status_code=500, detail=f"Patch generation error: {e}")


@app.post("/merge-patches", response_model=MergePatchesResponse)
async def merge_patches(request: MergePatchesRequest):
    """
    Merge patches onto page image

    Takes a page image and overlays multiple patches at specified positions.
    Used for permanently applying patches to the original page.

    Args:
        request: MergePatchesRequest with page image and patches

    Returns:
        MergePatchesResponse with merged image

    Raises:
        HTTPException: If image processing fails
    """
    try:
        # Decode base64 page image
        page_bytes = base64.b64decode(request.pageImageBase64)
        page_nparr = np.frombuffer(page_bytes, np.uint8)
        page_image = cv2.imdecode(page_nparr, cv2.IMREAD_COLOR)

        if page_image is None:
            raise ValueError("Failed to decode page image")

        # Detect original image format
        page_bytes_io = BytesIO(page_bytes)
        with Image.open(page_bytes_io) as img:
            original_format = img.format.lower() if img.format else "jpeg"

        logger.info(f"📄 Merging {len(request.patches)} patches onto page ({page_image.shape[1]}x{page_image.shape[0]})")

        # Convert to PIL for easier overlay operations
        page_pil = Image.fromarray(cv2.cvtColor(page_image, cv2.COLOR_BGR2RGB))

        # Overlay each patch
        for i, patch in enumerate(request.patches):
            try:
                # Decode patch image
                patch_bytes = base64.b64decode(patch.patchImageBase64)
                patch_nparr = np.frombuffer(patch_bytes, np.uint8)
                patch_cv = cv2.imdecode(patch_nparr, cv2.IMREAD_COLOR)

                if patch_cv is None:
                    logger.warning(f"⚠️  Skipping patch {i+1}: failed to decode")
                    continue

                # Convert patch to PIL
                patch_pil = Image.fromarray(cv2.cvtColor(patch_cv, cv2.COLOR_BGR2RGB))

                # Resize patch to target dimensions (handles device pixel ratio scaling)
                original_size = patch_pil.size
                target_size = (patch.width, patch.height)
                if original_size != target_size:
                    patch_pil = patch_pil.resize(target_size, Image.Resampling.LANCZOS)

                # Convert float coordinates to integers for PIL paste()
                x_pos = int(round(patch.x))
                y_pos = int(round(patch.y))

                # Paste patch at specified position
                page_pil.paste(patch_pil, (x_pos, y_pos))

            except Exception as e:
                logger.warning(f"⚠️  Skipping patch {i+1}: {e}")
                continue

        # Convert back to OpenCV format
        merged_cv = cv2.cvtColor(np.array(page_pil), cv2.COLOR_RGB2BGR)

        # Encode in the same format as original
        if original_format == "png":
            success, buffer = cv2.imencode(".png", merged_cv)
        elif original_format in ["jpeg", "jpg"]:
            success, buffer = cv2.imencode(".jpg", merged_cv, [cv2.IMWRITE_JPEG_QUALITY, 95])
        else:
            # Default to JPEG for unknown formats
            logger.warning(f"Unknown format '{original_format}', defaulting to JPEG")
            success, buffer = cv2.imencode(".jpg", merged_cv, [cv2.IMWRITE_JPEG_QUALITY, 95])

        if not success:
            raise ValueError(f"Failed to encode merged image as {original_format.upper()}")

        # Convert to base64
        merged_base64 = base64.b64encode(buffer).decode("utf-8")

        logger.success(f"✅ Merged {len(request.patches)} patches successfully")

        return MergePatchesResponse(
            status="success",
            mergedImage=merged_base64,
        )

    except base64.binascii.Error as e:
        logger.error(f"❌ Invalid base64 data: {e}")
        raise HTTPException(status_code=400, detail=f"Invalid base64 encoding: {e}")
    except Exception as e:
        logger.error(f"❌ Patch merging failed: {e}")
        raise HTTPException(status_code=500, detail=f"Patch merging error: {e}")


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
