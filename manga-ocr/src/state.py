"""
Global state and model loading for manga-ocr server
"""

import threading
from typing import Optional

from loguru import logger

from .ocr import MangaOcr

# Import AnimeLaMa
try:
    from .models.inpainting.anime_lama import AnimeLaMa
except ImportError as e:
    logger.warning(f"⚠️ AnimeLaMa import failed - inpaint endpoint will be unavailable: {e}")
    AnimeLaMa = None

# Build identifier
BUILD_ID = "2026-02-08_animelama"

# Model names
OCR_MODEL_NAME = "kha-white/manga-ocr-base"
ANIMELAMA_MODEL_NAME = "df1412/anime-big-lama"

# Global instances (loaded in background)
ocr_instance: Optional[MangaOcr] = None
animelama_instance: Optional["AnimeLaMa"] = None  # type: ignore
ocr_ready: bool = False
animelama_ready: bool = False


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


def _load_animelama_model() -> None:
    """Load AnimeLaMa model in background thread."""
    global animelama_instance, animelama_ready
    if AnimeLaMa is None:
        logger.warning("⚠️ AnimeLaMa not available - skipping load")
        return

    logger.info(f"📦 Loading AnimeLaMa model ({ANIMELAMA_MODEL_NAME})...")
    try:
        animelama_instance = AnimeLaMa(device="cpu")
        animelama_ready = True
        logger.success("✅ AnimeLaMa model loaded!")
    except Exception as e:
        logger.error(f"❌ Failed to load AnimeLaMa: {e}")


def start_model_loading() -> list[threading.Thread]:
    """
    Start model loading in background threads.

    Returns:
        List of model loading threads
    """
    threads = [
        threading.Thread(target=_load_ocr_model, daemon=True),
        threading.Thread(target=_load_animelama_model, daemon=True),
    ]
    for t in threads:
        t.start()
    return threads
