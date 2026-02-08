"""AnimeLaMa - Anime/Manga specialized LaMa inpainting model"""

import cv2
import numpy as np
import torch

from .helper import norm_img, load_jit_model, pad_img_to_modulo


class AnimeLaMa:
    """
    AnimeLaMa inpainting model for anime/manga images

    Specialized LaMa variant trained on anime/manga content.
    Smaller and faster than general LaMa (197MB vs 340MB).

    Model format: TorchScript (.pt file)
    Input: RGB image + grayscale mask (white = inpaint, black = keep)
    Output: BGR image (OpenCV format)
    """

    name = "anime-lama"
    pad_mod = 8  # Model requires dimensions divisible by 8

    def __init__(self, device="cuda"):
        """
        Initialize AnimeLaMa model

        Args:
            device: "cuda" or "cpu"
        """
        self.device = torch.device(device)
        self.model = None
        self.init_model(device)

    def init_model(self, device):
        """Load TorchScript model"""
        self.device = torch.device(device)
        self.model = load_jit_model(self.device).eval()
        print(f"AnimeLaMa model loaded on {self.device}")

    def forward(self, image, mask):
        """
        Run inpainting inference

        Args:
            image: RGB numpy array (H, W, 3)
            mask: Grayscale numpy array (H, W)
                  White pixels (255) = areas to inpaint
                  Black pixels (0) = areas to keep

        Returns:
            BGR numpy array (H, W, 3) - OpenCV format
        """
        # Ensure mask and image have the same dimensions
        if mask.shape[:2] != image.shape[:2]:
            mask = cv2.resize(
                mask, (image.shape[1], image.shape[0]), interpolation=cv2.INTER_NEAREST
            )

        # Pad image and mask to be divisible by pad_mod
        h, w = image.shape[:2]
        image = pad_img_to_modulo(image, self.pad_mod)
        mask = pad_img_to_modulo(mask, self.pad_mod)

        # Convert to tensor format
        image = norm_img(image)
        mask = norm_img(mask)

        # Binarize mask (white pixels = 1, black = 0)
        mask = (mask > 0) * 1
        image = torch.from_numpy(image).unsqueeze(0).to(self.device)
        mask = torch.from_numpy(mask).unsqueeze(0).to(self.device)

        # Run inference
        with torch.no_grad():
            inpainted_image = self.model(image, mask)

        # Post-process: denormalize, convert to numpy, crop to original size
        cur_res = inpainted_image[0].permute(1, 2, 0).detach().cpu().numpy()
        cur_res = np.clip(cur_res * 255, 0, 255).astype("uint8")
        cur_res = cv2.cvtColor(cur_res, cv2.COLOR_RGB2BGR)

        # Crop back to original dimensions
        cur_res = cur_res[:h, :w]

        return cur_res

    def inpaint(self, image, mask):
        """
        Convenience method for inpainting

        Args:
            image: RGB numpy array (H, W, 3)
            mask: Grayscale numpy array (H, W)

        Returns:
            BGR numpy array (H, W, 3)
        """
        return self.forward(image, mask)
