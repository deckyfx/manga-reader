"""
YOLO-based text region detection for manga pages.
"""

from typing import List
from PIL import Image
import io


class BoundingBox:
    """Bounding box for detected text region."""

    def __init__(self, x1: float, y1: float, x2: float, y2: float, confidence: float):
        self.x1 = round(x1)
        self.y1 = round(y1)
        self.x2 = round(x2)
        self.y2 = round(y2)
        self.confidence = round(confidence, 4)

    def to_dict(self) -> dict:
        """Convert to dictionary format."""
        return {
            "type": "rectangle",
            "x1": self.x1,
            "y1": self.y1,
            "x2": self.x2,
            "y2": self.y2,
            "confidence": self.confidence
        }


def predict_bounding_boxes(model, image_bytes: bytes) -> List[dict]:
    """
    Predict bounding boxes for text regions in manga page.

    Args:
        model: Loaded YOLO model instance
        image_bytes: Image data as bytes

    Returns:
        List of bounding boxes in format:
        [
            {
                "type": "rectangle",
                "x1": int, "y1": int, "x2": int, "y2": int,
                "confidence": float
            },
            ...
        ]
    """
    # Load image from bytes
    image = Image.open(io.BytesIO(image_bytes))

    # Perform inference
    results = model.predict(image, verbose=False)
    result = results[0]

    # Convert boxes to our format
    boxes = []
    for box in result.boxes:
        # YOLO format: [x1, y1, x2, y2, confidence, class_id]
        coords = [float(x) for x in box.xyxy[0].tolist()]
        conf = float(box.conf[0].item())

        bbox = BoundingBox(
            x1=coords[0],
            y1=coords[1],
            x2=coords[2],
            y2=coords[3],
            confidence=conf
        )
        boxes.append(bbox.to_dict())

    return boxes
