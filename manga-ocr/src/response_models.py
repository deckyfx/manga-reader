"""
Pydantic models for FastAPI endpoints
"""

from typing import Optional
from pydantic import BaseModel


class Point(BaseModel):
    """Point with x, y coordinates"""
    x: float
    y: float


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
    build_id: str


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
    alphaBackground: bool = False  # Transparent background (skip cleaning, text only)
    cleanerThreshold: int = 200  # Threshold for text detection (0-255, higher = only darker text)


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


class InpaintMaskResponse(BaseModel):
    """Response model for /inpaint-mask endpoint."""
    status: str
    cleanedImage: str  # Base64 encoded PNG
