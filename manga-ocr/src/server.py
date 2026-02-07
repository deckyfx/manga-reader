"""
FastAPI server for manga-ocr using Unix domain sockets

Endpoints:
- GET /health - Health check
- GET /status - Model readiness status
- POST /scan - OCR image scan (base64 JSON)
- POST /scan-upload - OCR image scan (file upload)
- POST /generate-patch - Generate translation patch
- POST /merge-patches - Merge patches onto page
"""

import os
import tomllib
from pathlib import Path
from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI, UploadFile, File
from loguru import logger

from .models import (
    ScanResponse, HealthResponse, StatusResponse,
    ImageRequest, PatchRequest, PatchResponse,
    MergePatchesRequest, MergePatchesResponse,
)
from .state import BUILD_ID, start_model_loading
from .handlers import (
    health_check,
    status,
    scan_image_base64,
    scan_image_upload,
    generate_patch,
    merge_patches,
)


def get_project_metadata() -> dict:
    """Load project metadata from pyproject.toml."""
    path = Path(__file__).parent.parent / "pyproject.toml"
    try:
        with open(path, "rb") as f:
            data = tomllib.load(f)
            return data.get("project", {})
    except FileNotFoundError:
        return {"title": "Manga OCR", "version": "0.0.0", "description": ""}


@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Lifespan context manager for FastAPI app.
    Server starts immediately — models load in background threads.
    """
    logger.info("Starting Manga OCR server...")
    logger.info(f"Build ID: {BUILD_ID}")

    start_model_loading()

    logger.info("Models loading in background...")
    logger.info("")
    logger.info("Available endpoints:")
    logger.info("   GET  /health           - Health check (Docker)")
    logger.info("   GET  /status           - Model readiness status")
    logger.info("   POST /scan             - Scan image (base64 JSON)")
    logger.info("   POST /scan-upload      - Scan image (file upload)")
    logger.info("   POST /generate-patch   - Generate translation patch")
    logger.info("   POST /merge-patches    - Merge patches onto page")

    yield

    logger.info("Shutting down Manga OCR server...")


meta = get_project_metadata()

app = FastAPI(
    title=meta.get("name", "Manga OCR Server"),
    description=meta.get("description", "OCR server for Japanese manga"),
    version=meta.get("version", "0.0.6"),
    lifespan=lifespan,
)


# --- Routes ---

@app.get("/health", response_model=HealthResponse)
async def route_health():
    """Health check endpoint (for Docker healthcheck)."""
    return await health_check()


@app.get("/status", response_model=StatusResponse)
async def route_status():
    """Model readiness status endpoint."""
    return await status()


@app.post("/scan", response_model=ScanResponse)
async def route_scan(request: ImageRequest):
    """Scan image from base64 encoded data."""
    return await scan_image_base64(request)


@app.post("/scan-upload", response_model=ScanResponse)
async def route_scan_upload(file: UploadFile = File(...)):
    """Scan image from file upload."""
    return await scan_image_upload(file)


@app.post("/generate-patch", response_model=PatchResponse)
async def route_generate_patch(request: PatchRequest):
    """Generate patch image with translated text overlay."""
    return await generate_patch(request)


@app.post("/merge-patches", response_model=MergePatchesResponse)
async def route_merge_patches(request: MergePatchesRequest):
    """Merge patches onto page image."""
    return await merge_patches(request)


def start_server(socket_path: str = "/app/sock/manga-ocr.sock", log_level: str = "info"):
    """
    Start the FastAPI server on Unix domain socket.

    Args:
        socket_path: Path to Unix domain socket
        log_level: Logging level (debug, info, warning, error)
    """
    socket_dir = os.path.dirname(socket_path)
    os.makedirs(socket_dir, exist_ok=True)

    if os.path.exists(socket_path):
        os.remove(socket_path)

    logger.info(f"Binding to Unix socket: {socket_path}")

    try:
        uvicorn.run(
            app,
            uds=socket_path,
            log_level=log_level,
            access_log=True,
        )
    finally:
        if os.path.exists(socket_path):
            os.remove(socket_path)
            logger.info(f"Cleaned up socket: {socket_path}")


if __name__ == "__main__":
    start_server()
