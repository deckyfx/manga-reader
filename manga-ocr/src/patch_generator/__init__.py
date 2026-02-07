"""
Patch Generator Module

Provides text cleaning and rendering functionality for manga translation patches.
"""

from .text_cleaner import (
    clean_text_region,
    clean_text_region_advanced,
    TextCleaner,
    OpenCVCleaner,
    LamaCleaner,
    create_cleaner,
)
from .text_renderer import render_text
from .lama import SimpleLama

__all__ = [
    "clean_text_region",
    "clean_text_region_advanced",
    "TextCleaner",
    "OpenCVCleaner",
    "LamaCleaner",
    "create_cleaner",
    "render_text",
    "SimpleLama",
]
