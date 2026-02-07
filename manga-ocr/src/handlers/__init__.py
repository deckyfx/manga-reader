"""
Handler package - one handler per file for maintainability.

Re-exports all handler functions for convenient imports.
"""

from .health import health_check, status
from .scan import scan_image_base64
from .scan_upload import scan_image_upload
from .patch import generate_patch
from .merge import merge_patches

__all__ = [
    "health_check",
    "status",
    "scan_image_base64",
    "scan_image_upload",
    "generate_patch",
    "merge_patches",
]
