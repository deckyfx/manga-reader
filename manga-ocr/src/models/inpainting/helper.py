"""Helper functions for inpainting models"""

import os
import torch
import numpy as np
import cv2
from huggingface_hub import hf_hub_download


def norm_img(img):
    """Normalize image to [0, 1] range and convert to CHW format"""
    if isinstance(img, np.ndarray):
        if len(img.shape) == 2:
            img = img[:, :, np.newaxis]
        img = img.transpose(2, 0, 1)
        img = img.astype("float32") / 255.0
    return img


def get_model_path():
    """
    Get path to AnimeLaMa model file (auto-downloads from Hugging Face).

    Downloads from df1412/anime-big-lama repository.
    Model will be cached in ~/.cache/huggingface/hub/
    """
    model_path = hf_hub_download(
        repo_id="df1412/anime-big-lama",
        filename="anime-manga-big-lama.pt",
        repo_type="model",
    )
    return model_path


def load_jit_model(device):
    """
    Load AnimeLaMa model (auto-downloads if needed).

    The model is downloaded from Hugging Face and cached locally.
    Attempts to load as TorchScript first, falls back to regular checkpoint.
    """
    model_path = get_model_path()

    with torch.no_grad():
        try:
            # Try loading as TorchScript model first
            model = torch.jit.load(model_path, map_location=device)
        except RuntimeError:
            # If not TorchScript, load as regular checkpoint
            # This typically means it's a regular PyTorch state_dict
            checkpoint = torch.load(model_path, map_location=device)
            # For LaMa checkpoints, the model is usually under 'model' key
            if isinstance(checkpoint, dict) and 'model' in checkpoint:
                model = checkpoint['model']
            else:
                model = checkpoint
    return model


def pad_img_to_modulo(img, mod_pad):
    """
    Pad image to be divisible by mod_pad

    Args:
        img: numpy array (H, W) or (H, W, C)
        mod_pad: modulo value (typically 8 for LaMa)

    Returns:
        Padded image
    """
    if len(img.shape) == 3:
        h, w, _ = img.shape
    else:
        h, w = img.shape

    bottom = (mod_pad - h % mod_pad) % mod_pad
    right = (mod_pad - w % mod_pad) % mod_pad

    if len(img.shape) == 3:
        return cv2.copyMakeBorder(img, 0, bottom, 0, right, cv2.BORDER_REFLECT)
    else:
        return cv2.copyMakeBorder(img, 0, bottom, 0, right, cv2.BORDER_REFLECT)
