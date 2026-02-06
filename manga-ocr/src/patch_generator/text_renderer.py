"""
Text Renderer - Manual Control

User provides:
- Text with manual line breaks (newlines)
- Font size
- Font type
- Text color
- Stroke color and width

Renderer centers the text vertically and horizontally.
"""

import cv2
import numpy as np
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont


def hex_to_rgb(hex_color: str) -> tuple[int, int, int]:
    """
    Convert hex color to RGB tuple

    Args:
        hex_color: Hex color string (e.g., "#FF0000" or "FF0000")

    Returns:
        RGB tuple (r, g, b)
    """
    hex_color = hex_color.lstrip("#")
    return tuple(int(hex_color[i:i+2], 16) for i in (0, 2, 4))


def get_font_path(font_type: str = "regular") -> Path:
    """
    Get font path for specified font type

    Uses Anime Ace fonts bundled in /app/fonts/

    Args:
        font_type: Font type ("regular", "bold", "italic")

    Returns:
        Path to font file

    Raises:
        FileNotFoundError: If font not found
    """
    # Anime Ace fonts (copied from src/public/fonts/anime-ace/)
    font_paths = {
        "regular": Path("/app/fonts/animeace.ttf"),
        "bold": Path("/app/fonts/animeace_b.ttf"),
        "italic": Path("/app/fonts/animeace_i.ttf"),
    }

    # Get font path (default to regular)
    font_path = font_paths.get(font_type, font_paths["regular"])

    if font_path.exists():
        return font_path

    # Error if not found
    raise FileNotFoundError(
        f"Anime Ace font not found at {font_path}. "
        f"Ensure fonts are copied during Docker build."
    )


def render_text(
    image: np.ndarray,
    text: str,
    width: int,
    height: int,
    font_size: int = 24,
    font_type: str = "regular",
    text_color: str = "#000000",
    stroke_color: str | None = None,
    stroke_width: int = 0,
) -> np.ndarray:
    """
    Render text with manual control (no auto-sizing or wrapping)

    Args:
        image: Input image (BGR format from cv2)
        text: Text to render (with manual line breaks using \\n)
        width: Region width in pixels
        height: Region height in pixels
        font_size: Font size in pixels (user-specified)
        font_type: Font type ("regular", "bold", "italic")
        text_color: Text color in hex (e.g., "#000000")
        stroke_color: Stroke color in hex (None for no stroke)
        stroke_width: Stroke width in pixels (0 for no stroke)

    Returns:
        Image with rendered text (BGR format)

    Example:
        >>> image = cv2.imread("region.png")
        >>> result = render_text(
        ...     image,
        ...     "Line 1\\nLine 2\\nLine 3",
        ...     300, 150,
        ...     font_size=28,
        ...     text_color="#000000"
        ... )
    """
    # Convert cv2 BGR to PIL RGB
    pil_image = Image.fromarray(cv2.cvtColor(image, cv2.COLOR_BGR2RGB))
    draw = ImageDraw.Draw(pil_image)

    # Get font
    font_path = get_font_path(font_type)
    font = ImageFont.truetype(str(font_path), font_size)

    # Convert colors
    text_rgb = hex_to_rgb(text_color)

    # Measure text bbox (multiline)
    bbox = draw.multiline_textbbox(
        (0, 0),
        text,
        font=font,
        spacing=4,  # Fixed spacing
        align="center",
    )

    text_w = bbox[2] - bbox[0]
    text_h = bbox[3] - bbox[1]

    # Center position
    x = (width - text_w) // 2 - bbox[0]
    y = (height - text_h) // 2 - bbox[1]

    # Draw stroke if requested
    if stroke_color and stroke_width > 0:
        stroke_rgb = hex_to_rgb(stroke_color)

        # Draw stroke by rendering text multiple times with offset
        for dx in range(-stroke_width, stroke_width + 1):
            for dy in range(-stroke_width, stroke_width + 1):
                if dx != 0 or dy != 0:
                    draw.multiline_text(
                        (x + dx, y + dy),
                        text,
                        font=font,
                        fill=stroke_rgb,
                        spacing=4,
                        align="center",
                    )

    # Draw main text
    draw.multiline_text(
        (x, y),
        text,
        font=font,
        fill=text_rgb,
        spacing=4,
        align="center",
    )

    # Convert back to BGR
    return cv2.cvtColor(np.array(pil_image), cv2.COLOR_RGB2BGR)
