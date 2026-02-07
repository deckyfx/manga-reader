"""
Global state and model loading for manga-ocr server
"""

import os
import threading
from typing import Optional

import torch
from loguru import logger

from .ocr import MangaOcr
from .patch_generator import create_cleaner, SimpleLama
from .patch_generator.text_cleaner import TextCleaner

# Build identifier
BUILD_ID = "2026-02-07_lama_er0manga"

# Model names
OCR_MODEL_NAME = "kha-white/manga-ocr-base"
CLEANER_MODEL_NAME_LAMA = "df1412/er0manga-inpaint"
CLEANER_MODEL_NAME_OPENCV = "opencv-inpaint"

# Global instances (loaded in background)
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


def start_model_loading() -> tuple[threading.Thread, threading.Thread]:
    """
    Start model loading in background threads.
    
    Returns:
        Tuple of (ocr_thread, cleaner_thread)
    """
    ocr_thread = threading.Thread(target=_load_ocr_model, daemon=True)
    cleaner_thread = threading.Thread(target=_load_cleaner_model, daemon=True)
    ocr_thread.start()
    cleaner_thread.start()
    return ocr_thread, cleaner_thread
