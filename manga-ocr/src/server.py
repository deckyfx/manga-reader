"""
FastAPI server for manga-ocr using Unix domain sockets

Endpoints:
- GET /health - Health check
- POST /scan - OCR image scan (accepts base64 or binary data)
"""

# Build identifier - update this timestamp before building to verify new image
BUILD_ID = "2026-02-07_lama_er0manga"

import asyncio
import base64
import os
import threading
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

import torch

from .ocr import MangaOcr
from .patch_generator import clean_text_region, create_cleaner, SimpleLama
from .patch_generator.text_cleaner import TextCleaner
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


class ModelStatus(BaseModel):
    """Status of a single model"""
    name: str
    ready: bool


class StatusResponse(BaseModel):
    """Response model for /status endpoint"""
    models: dict[str, ModelStatus]


class HealthResponse(BaseModel):
    """Response model for health check"""
    status: str
    model_loaded: bool
    cleaner_mode: str = "opencv"
    build_id: str = BUILD_ID


class Point(BaseModel):
    """Point with x, y coordinates"""
    x: float
    y: float


class PatchRequest(BaseModel):
    """Request model for patch generation"""
    capturedImage: str  # Base64 encoded image (dimensions auto-detected)
    translatedText: list[str]  # Array of text lines (will be joined with newlines)
    fontSize: int = 24  # Font size in pixels
    fontType: str = "regular"  # Font type: regular, bold, italic
    textColor: str = "#000000"  # Text color in hex (e.g., #000000 for black)
    strokeColor: str | None = None  # Stroke color in hex (None for no stroke)
    strokeWidth: int = 0  # Stroke width in pixels (0 for no stroke)
    polygonPoints: list[Point] | None = None  # Polygon points for masking (relative coordinates)


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
    width: Optional[int] = None  # Target width (will resize patch to this)
    height: Optional[int] = None  # Target height (will resize patch to this)


class MergePatchesRequest(BaseModel):
    """Request model for merging patches onto page image"""
    pageImageBase64: str  # Base64 encoded original page image
    patches: list[PatchOverlay]  # List of patches with positions


class MergePatchesResponse(BaseModel):
    """Response model for merge patches"""
    status: str
    mergedImage: str  # Base64 encoded merged image


# ── Model names ──────────────────────────────────────────
OCR_MODEL_NAME = "kha-white/manga-ocr-base"
CLEANER_MODEL_NAME_LAMA = "df1412/er0manga-inpaint"
CLEANER_MODEL_NAME_OPENCV = "opencv-inpaint"

# ── Global instances (loaded in background) ──────────────
ocr_instance: Optional[MangaOcr] = None
text_cleaner: Optional[TextCleaner] = None
cleaner_mode: str = "opencv"
ocr_ready: bool = False
cleaner_ready: bool = False


def _load_ocr_model() -> None:
    """Load OCR model in background thread."""
    global ocr_instance, ocr_ready
    logger.info(f"📦 Loading OCR model ({OCR_MODEL_NAME})...")
    try:
        ocr_instance = MangaOcr(force_cpu=True)
        ocr_ready = True
        logger.success("✅ OCR model loaded!")
    except Exception as e:
        logger.error(f"❌ Failed to load OCR model: {e}")


def _load_cleaner_model() -> None:
    """Load text cleaner model in background thread."""
    global text_cleaner, cleaner_ready, cleaner_mode
    cleaner_mode = os.environ.get("CLEANER_MODE", "lama")
    logger.info(f"🧹 Cleaner mode: {cleaner_mode}")

    if cleaner_mode == "lama":
        logger.info(f"📦 Loading Er0mangaInpaint model ({CLEANER_MODEL_NAME_LAMA})...")
        try:
            lama_model = SimpleLama(device=torch.device("cpu"))
            text_cleaner = create_cleaner("lama", lama_model=lama_model)
            cleaner_ready = True
            logger.success("✅ Er0mangaInpaint model loaded!")
        except Exception as e:
            logger.error(f"❌ Failed to load LaMa model: {e}")
            logger.warning("⚠️ Falling back to OpenCV cleaner")
            cleaner_mode = "opencv"
            text_cleaner = create_cleaner("opencv")
            cleaner_ready = True
    else:
        logger.info("📦 Using OpenCV inpainting (fast mode)")
        text_cleaner = create_cleaner("opencv")
        cleaner_ready = True


@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Lifespan context manager for FastAPI app.
    Server starts immediately — models load in background threads.
    """
    logger.info("🚀 Starting Manga OCR server...")
    logger.info(f"🏷️  Build ID: {BUILD_ID}")

    # Start model loading in background threads
    ocr_thread = threading.Thread(target=_load_ocr_model, daemon=True)
    cleaner_thread = threading.Thread(target=_load_cleaner_model, daemon=True)
    ocr_thread.start()
    cleaner_thread.start()

    logger.info("⏳ Models loading in background...")
    logger.info("")
    logger.info("📡 Available endpoints:")
    logger.info("   GET  /health           - Health check (Docker)")
    logger.info("   GET  /status           - Model readiness status")
    logger.info("   POST /scan             - Scan image (base64 JSON)")
    logger.info("   POST /scan-upload      - Scan image (file upload)")
    logger.info("   POST /generate-patch   - Generate translation patch")
    logger.info("   POST /merge-patches    - Merge patches onto page")

    yield

    # Shutdown: Cleanup
    logger.info("👋 Shutting down Manga OCR server...")


meta = get_project_metadata()

# Initialize FastAPI app with lifespan
app = FastAPI(
    title=meta.get("name", "Manga OCR Server"),
    description=meta.get("description", "OCR server for Japanese manga"),
    version=meta.get("version", "0.0.6"),
    lifespan=lifespan,
)


@app.get("/health", response_model=HealthResponse)
async def health_check():
    """
    Health check endpoint (for Docker healthcheck).
    Returns healthy as soon as server is accepting connections.
    """
    return HealthResponse(
        status="healthy",
        model_loaded=ocr_ready and cleaner_ready,
        cleaner_mode=cleaner_mode,
        build_id=BUILD_ID,
    )


@app.get("/status", response_model=StatusResponse)
async def status():
    """
    Model readiness status endpoint.
    Reports loading state of each model independently.
    """
    cleaner_name = CLEANER_MODEL_NAME_LAMA if cleaner_mode == "lama" else CLEANER_MODEL_NAME_OPENCV
    return StatusResponse(
        models={
            "ocr": ModelStatus(name=OCR_MODEL_NAME, ready=ocr_ready),
            "cleaner": ModelStatus(name=cleaner_name, ready=cleaner_ready),
        }
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

        # Check if polygon masking is needed
        use_polygon_mask = (
            request.polygonPoints is not None
            and len(request.polygonPoints) >= 3
        )

        if use_polygon_mask:
            logger.info(f"🔺 Using polygon mask with {len(request.polygonPoints)} points")

            # Step 1: Create polygon mask
            mask = np.zeros((height, width), dtype=np.uint8)
            pts = np.array(
                [[int(round(p.x)), int(round(p.y))] for p in request.polygonPoints],
                dtype=np.int32
            )
            cv2.fillPoly(mask, [pts], 255)

            # Step 2: Clean text from region (only inside polygon)
            logger.info("🧹 Cleaning text from region...")
            cleaned_image = clean_text_region(image, cleaner=text_cleaner)

            # Step 3: Convert to RGBA with alpha channel from mask
            cleaned_rgba = cv2.cvtColor(cleaned_image, cv2.COLOR_BGR2BGRA)
            cleaned_rgba[:, :, 3] = mask  # Set alpha channel

            # Use RGBA image for text rendering (LaMa reconstructs background, no white fill)
            cleaned_image = cleaned_rgba
        else:
            # Step 1: Clean text from region (no masking)
            logger.info("🧹 Cleaning text from region...")
            cleaned_image = clean_text_region(image, cleaner=text_cleaner)

        # Step 2: Render translated text with manual settings
        # Join array of lines with newlines
        text_with_newlines = "\n".join(request.translatedText)
        logger.info(f"✍️  Rendering text: '{text_with_newlines[:50]}...'")

        if use_polygon_mask:
            # For RGBA images, convert to PIL for text rendering
            from PIL import ImageDraw, ImageFont
            from .patch_generator.text_renderer import hex_to_rgb, get_font_path

            # Convert BGRA (OpenCV) to RGBA (PIL)
            cleaned_rgba_pil = cv2.cvtColor(cleaned_image, cv2.COLOR_BGRA2RGBA)

            # Convert to PIL Image
            pil_image = Image.fromarray(cleaned_rgba_pil, mode='RGBA')

            # Use proper font loading from text_renderer
            font_path = get_font_path(request.fontType)
            try:
                font = ImageFont.truetype(font_path, request.fontSize)
            except Exception as e:
                logger.warning(f"⚠️  Failed to load font {font_path}: {e}, using default")
                font = ImageFont.load_default()

            # Parse colors using proper hex_to_rgb function
            text_rgb = hex_to_rgb(request.textColor)
            stroke_rgb = hex_to_rgb(request.strokeColor) if request.strokeColor else None

            # Calculate polygon bounding box for text centering
            poly_points = [(int(round(p.x)), int(round(p.y))) for p in request.polygonPoints]
            poly_xs = [p[0] for p in poly_points]
            poly_ys = [p[1] for p in poly_points]
            poly_min_x = min(poly_xs)
            poly_max_x = max(poly_xs)
            poly_min_y = min(poly_ys)
            poly_max_y = max(poly_ys)
            poly_center_x = (poly_min_x + poly_max_x) // 2
            poly_center_y = (poly_min_y + poly_max_y) // 2

            # Use multiline_textbbox for proper alignment calculation
            draw = ImageDraw.Draw(pil_image)
            bbox = draw.multiline_textbbox(
                (0, 0),
                text_with_newlines,
                font=font,
                align='center'
            )
            text_width = bbox[2] - bbox[0]
            text_height = bbox[3] - bbox[1]

            # Center text in polygon bounds, accounting for bbox offset
            text_x = poly_center_x - text_width // 2 - bbox[0]
            text_y = poly_center_y - text_height // 2 - bbox[1]

            # Draw stroke first if specified (same method as text_renderer)
            if stroke_rgb and request.strokeWidth > 0:
                # Draw stroke by offsetting text in 8 directions
                for dx in [-request.strokeWidth, 0, request.strokeWidth]:
                    for dy in [-request.strokeWidth, 0, request.strokeWidth]:
                        if dx == 0 and dy == 0:
                            continue
                        draw.multiline_text(
                            (text_x + dx, text_y + dy),
                            text_with_newlines,
                            font=font,
                            fill=stroke_rgb,
                            align='center'
                        )

            # Draw main text on top
            draw.multiline_text(
                (text_x, text_y),
                text_with_newlines,
                font=font,
                fill=text_rgb,
                align='center'
            )

            # Convert back to numpy array
            patch_image = np.array(pil_image)
        else:
            # Use existing render_text for non-polygon patches
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

        # Step 3: Encode as PNG (with alpha channel if RGBA)
        if use_polygon_mask:
            # patch_image is already RGBA from PIL, no conversion needed
            pil_img = Image.fromarray(patch_image, mode='RGBA')

            # Encode as PNG with transparency
            buffer_io = BytesIO()
            pil_img.save(buffer_io, format='PNG')
            buffer = buffer_io.getvalue()
            success = True
        else:
            # Standard BGR encoding
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
                # Decode patch image (preserve alpha channel for polygon patches)
                patch_bytes = base64.b64decode(patch.patchImageBase64)
                patch_nparr = np.frombuffer(patch_bytes, np.uint8)
                patch_cv = cv2.imdecode(patch_nparr, cv2.IMREAD_UNCHANGED)

                if patch_cv is None:
                    logger.warning(f"⚠️  Skipping patch {i+1}: failed to decode")
                    continue

                # Check if patch has alpha channel (polygon patches)
                has_alpha = patch_cv.shape[2] == 4 if len(patch_cv.shape) == 3 else False

                # Convert patch to PIL with proper color space
                if has_alpha:
                    # BGRA -> RGBA for polygon patches with transparency
                    patch_pil = Image.fromarray(cv2.cvtColor(patch_cv, cv2.COLOR_BGRA2RGBA), mode='RGBA')
                else:
                    # BGR -> RGB for regular rectangle patches
                    patch_pil = Image.fromarray(cv2.cvtColor(patch_cv, cv2.COLOR_BGR2RGB))

                # Resize patch to target dimensions (handles device pixel ratio scaling)
                original_size = patch_pil.size
                if patch.width is not None and patch.height is not None:
                    target_size = (patch.width, patch.height)
                    if original_size != target_size:
                        patch_pil = patch_pil.resize(target_size, Image.Resampling.LANCZOS)

                # Convert float coordinates to integers for PIL paste()
                x_pos = int(round(patch.x))
                y_pos = int(round(patch.y))

                # Paste patch at specified position
                # For RGBA patches, use alpha channel as mask to preserve transparency
                if has_alpha:
                    page_pil.paste(patch_pil, (x_pos, y_pos), patch_pil)
                else:
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
