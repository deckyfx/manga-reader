"""
Core OCR functionality for manga text recognition

Modernized version compatible with:
- PyTorch 2.5+
- Transformers 4.40+
- NumPy 1.26+
"""

import re
from pathlib import Path
from typing import Union

import jaconv
import torch
from PIL import Image
from loguru import logger
from transformers import (
    AutoTokenizer,
    VisionEncoderDecoderModel,
    ViTImageProcessor,
)


class MangaOcr:
    """
    OCR for Japanese manga using Vision Transformer model

    Args:
        pretrained_model_name_or_path: Model identifier (default: kha-white/manga-ocr-base)
        force_cpu: Force CPU usage even if GPU available

    Example:
        >>> from manga_ocr_modern import MangaOcr
        >>> mocr = MangaOcr()
        >>> text = mocr("path/to/image.jpg")
        >>> print(text)
    """

    def __init__(
        self,
        pretrained_model_name_or_path: str = "kha-white/manga-ocr-base",
        force_cpu: bool = False,
    ):
        logger.info(f"Loading OCR model from {pretrained_model_name_or_path}")

        # Load model components
        self.processor = ViTImageProcessor.from_pretrained(pretrained_model_name_or_path)
        self.tokenizer = AutoTokenizer.from_pretrained(pretrained_model_name_or_path)
        self.model = VisionEncoderDecoderModel.from_pretrained(pretrained_model_name_or_path)

        # Device selection (GPU/CPU)
        if not force_cpu and torch.cuda.is_available():
            logger.info("Using CUDA GPU")
            self.model.cuda()
        elif not force_cpu and torch.backends.mps.is_available():
            logger.info("Using Apple Silicon GPU (MPS)")
            self.model.to("mps")
        else:
            logger.info("Using CPU")

        # Warmup run (makes first real OCR faster)
        # Note: Original used example.jpg from package, we'll skip for now
        logger.info("OCR ready")

    def __call__(self, img_or_path: Union[str, Path, Image.Image]) -> str:
        """
        Perform OCR on an image

        Args:
            img_or_path: Image file path (str/Path) or PIL Image

        Returns:
            Recognized Japanese text
        """
        # Load image
        if isinstance(img_or_path, (str, Path)):
            img = Image.open(img_or_path)
        elif isinstance(img_or_path, Image.Image):
            img = img_or_path
        else:
            raise ValueError(
                f"img_or_path must be a path or PIL.Image, got: {type(img_or_path)}"
            )

        # Convert to RGB (model expects RGB)
        img = img.convert("L").convert("RGB")

        # Preprocess
        pixel_values = self.processor(img, return_tensors="pt").pixel_values
        pixel_values = pixel_values.to(self.model.device)

        # Generate text
        with torch.no_grad():
            generated_ids = self.model.generate(
                pixel_values,
                max_length=300,
            )

        # Decode
        text = self.tokenizer.decode(
            generated_ids[0],
            skip_special_tokens=True,
        )

        # Post-process
        text = self._post_process(text)

        return text

    @staticmethod
    def _post_process(text: str) -> str:
        """
        Clean up OCR output

        - Remove whitespace
        - Normalize ellipsis
        - Convert half-width to full-width characters
        """
        # Remove all whitespace
        text = "".join(text.split())

        # Normalize ellipsis
        text = text.replace("…", "...")

        # Replace multiple dots/middle dots with dots
        text = re.sub(r"[・.]{2,}", lambda x: "." * (x.end() - x.start()), text)

        # Convert half-width to full-width (ASCII and digits)
        text = jaconv.h2z(text, ascii=True, digit=True)

        return text
