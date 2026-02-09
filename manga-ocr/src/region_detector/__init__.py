"""
Region detector module for automatic text region detection using YOLO.
"""

from .predict import predict_bounding_boxes

__all__ = ["predict_bounding_boxes"]
