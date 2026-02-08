"""
Merge patches handler — composites multiple patch overlays onto a page image.
"""

import cv2
import numpy as np
from fastapi import HTTPException
from loguru import logger

from ..response_models import MergePatchesRequest, MergePatchesResponse
from ..utils import decode_base64_image, encode_image_to_base64


async def merge_patches(request: MergePatchesRequest) -> MergePatchesResponse:
    """
    Merge multiple patches onto a page image.

    Args:
        request: MergePatchesRequest with page image and patches

    Returns:
        MergePatchesResponse with merged image

    Raises:
        HTTPException: If merging fails
    """
    try:
        page_image = decode_base64_image(request.pageImageBase64)
        page_h, page_w = page_image.shape[:2]

        logger.info(f"Merging {len(request.patches)} patches onto {page_w}x{page_h} page")

        # Convert to RGBA for alpha blending
        if page_image.shape[2] == 3:
            page_rgba = cv2.cvtColor(page_image, cv2.COLOR_BGR2BGRA)
        else:
            page_rgba = page_image.copy()

        # Overlay each patch
        for i, patch in enumerate(request.patches):
            patch_image = decode_base64_image(patch.patchImageBase64)

            # Convert patch to RGBA if needed
            if patch_image.shape[2] == 3:
                patch_rgba = cv2.cvtColor(patch_image, cv2.COLOR_BGR2BGRA)
            else:
                patch_rgba = patch_image

            # Resize if dimensions specified
            if patch.width and patch.height:
                patch_rgba = cv2.resize(patch_rgba, (patch.width, patch.height))

            patch_h, patch_w = patch_rgba.shape[:2]
            x = int(round(patch.x))
            y = int(round(patch.y))

            # Bounds check
            if x < 0 or y < 0 or x + patch_w > page_w or y + patch_h > page_h:
                logger.warning(f"Patch {i} out of bounds, skipping")
                continue

            # Alpha blend
            alpha = patch_rgba[:, :, 3:4] / 255.0
            page_rgba[y : y + patch_h, x : x + patch_w] = (
                alpha * patch_rgba[:, :, :4]
                + (1 - alpha) * page_rgba[y : y + patch_h, x : x + patch_w]
            ).astype(np.uint8)

        # Convert back to BGR
        result_bgr = cv2.cvtColor(page_rgba, cv2.COLOR_BGRA2BGR)
        merged_base64 = encode_image_to_base64(result_bgr, "jpg")

        logger.info(f"Merged image: {len(merged_base64)} bytes")

        return MergePatchesResponse(
            status="success",
            mergedImage=merged_base64,
        )

    except Exception as e:
        logger.error(f"Merge patches error: {e}")
        raise HTTPException(status_code=500, detail=f"Merge failed: {str(e)}")
