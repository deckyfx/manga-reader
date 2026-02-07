"""
Utility functions for image processing
"""

import base64
from io import BytesIO

import cv2
import numpy as np
from PIL import Image


def decode_base64_image(base64_str: str) -> np.ndarray:
    """
    Decode base64 string to OpenCV image (BGR).
    
    Args:
        base64_str: Base64 encoded image
        
    Returns:
        OpenCV image (BGR format)
        
    Raises:
        ValueError: If image cannot be decoded
    """
    image_bytes = base64.b64decode(base64_str)
    nparr = np.frombuffer(image_bytes, np.uint8)
    image = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    
    if image is None:
        raise ValueError("Failed to decode image")
        
    return image


def encode_image_to_base64(image: np.ndarray, format: str = "png") -> str:
    """
    Encode OpenCV image to base64 string.
    
    Args:
        image: OpenCV image (BGR or BGRA format)
        format: Output format (png, jpg, etc.)
        
    Returns:
        Base64 encoded image string
    """
    _, buffer = cv2.imencode(f".{format}", image)
    return base64.b64encode(buffer).decode("utf-8")


def pil_to_base64(pil_image: Image.Image, format: str = "PNG") -> str:
    """
    Convert PIL Image to base64 string.
    
    Args:
        pil_image: PIL Image
        format: Output format (PNG, JPEG, etc.)
        
    Returns:
        Base64 encoded image string
    """
    buffer = BytesIO()
    pil_image.save(buffer, format=format)
    return base64.b64encode(buffer.getvalue()).decode("utf-8")


def base64_to_pil(base64_str: str) -> Image.Image:
    """
    Convert base64 string to PIL Image.
    
    Args:
        base64_str: Base64 encoded image
        
    Returns:
        PIL Image
    """
    image_bytes = base64.b64decode(base64_str)
    return Image.open(BytesIO(image_bytes))
