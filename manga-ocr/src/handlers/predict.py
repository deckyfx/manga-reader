"""
Region prediction handler using YOLO.
"""

import base64
import io
from PIL import Image
from fastapi import HTTPException

from ..response_models import PredictRegionsRequest, PredictRegionsResponse, BoundingBox
from .. import state
from ..region_detector import predict_bounding_boxes


async def predict_regions(request: PredictRegionsRequest) -> PredictRegionsResponse:
    """
    Predict text regions in manga page using YOLO.

    Args:
        request: Request with base64 encoded image

    Returns:
        Response with detected bounding boxes
    """
    # Check if YOLO model is loaded
    if not state.yolo_ready or state.yolo_instance is None:
        raise HTTPException(status_code=503, detail="YOLO model not ready")

    try:
        # Decode base64 image
        image_data = base64.b64decode(request.image)

        # Get image size
        image = Image.open(io.BytesIO(image_data))
        image_size = image.size  # (width, height)

        # Predict bounding boxes
        boxes = predict_bounding_boxes(state.yolo_instance, image_data)

        # Convert to response format
        bbox_list = [BoundingBox(**box) for box in boxes]

        return PredictRegionsResponse(
            status="success",
            regions=bbox_list,
            image_size=image_size
        )

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Prediction failed: {str(e)}")
