"""
LaMa Inpainting — SimpleLama inference wrapper

Loads the Er0mangaInpaint pretrained model (FFCResNetGenerator) and provides
a simple PIL-in / PIL-out API for text region inpainting.

Model: Er0mangaInpaint ffc_resnet (n_blocks=9, input_nc=4, output_nc=3, sigmoid)
Source: https://huggingface.co/df1412/er0manga-inpaint
License: MIT (simple-lama-inpainting / Er0mangaInpaint)
"""

import os
from pathlib import Path

import cv2
import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F
import yaml
from huggingface_hub import hf_hub_download
from loguru import logger
from PIL import Image

from .ffc import FFCResNetGenerator

HF_REPO_ID = "df1412/er0manga-inpaint"


def _resolve_omegaconf_refs(config: dict) -> dict:
    """
    Resolve OmegaConf-style ${...} interpolation references in a YAML config.

    Handles patterns like:
        ratio_gin: ${generator.init_conv_kwargs.ratio_gout}

    Only resolves references within the same config dict (no env vars).
    """

    def _get_by_path(root: dict, path: str):
        """Walk a dotted path like 'generator.init_conv_kwargs.ratio_gout'."""
        parts = path.split(".")
        current = root
        for part in parts:
            if isinstance(current, dict) and part in current:
                current = current[part]
            else:
                raise KeyError(f"Cannot resolve path '{path}': missing key '{part}'")
        return current

    def _resolve_value(val, root: dict):
        if not isinstance(val, str):
            return val
        if not val.startswith("${") or not val.endswith("}"):
            return val
        ref = val[2:-1]
        # Skip env: references (e.g. ${env:TORCH_HOME})
        if ref.startswith("env:"):
            return val
        return _get_by_path(root, ref)

    def _resolve_dict(d: dict, root: dict) -> dict:
        resolved = {}
        for k, v in d.items():
            if isinstance(v, dict):
                resolved[k] = _resolve_dict(v, root)
            elif isinstance(v, list):
                resolved[k] = [_resolve_value(item, root) if isinstance(item, str) else item for item in v]
            else:
                resolved[k] = _resolve_value(v, root)
        return resolved

    # Two passes to handle chained references (A→B→value)
    result = _resolve_dict(config, config)
    result = _resolve_dict(result, result)
    return result


class SimpleLama:
    """
    LaMa inpainting model wrapper.

    Loads the Er0mangaInpaint pretrained checkpoint (FFCResNetGenerator)
    from Hugging Face and provides inference via __call__.

    Model files are auto-downloaded from HF and cached locally.

    Args:
        device: Torch device (default: CPU)

    Example:
        >>> lama = SimpleLama()
        >>> result = lama(pil_image, pil_mask)
    """

    def __init__(self, device: torch.device | None = None):
        self.device = device or torch.device("cpu")
        self.generator = self._load_model()

    @staticmethod
    def _install_pickle_mocks(sys_module) -> list[str]:
        """
        Install mock modules so torch.load can unpickle the PL checkpoint.

        The Er0mangaInpaint checkpoint was saved with PyTorch Lightning + OmegaConf.
        Pickle needs these classes to exist during deserialization.
        We only use state_dict from the checkpoint, so the mocks are just stubs.

        Returns list of module names that were mocked (for cleanup).
        """
        import types

        mocked: list[str] = []

        # --- pytorch_lightning mocks ---
        pl_modules = {
            "pytorch_lightning": {},
            "pytorch_lightning.callbacks": {},
            "pytorch_lightning.callbacks.model_checkpoint": {
                "ModelCheckpoint": type("ModelCheckpoint", (), {}),
            },
        }

        # --- omegaconf mocks ---
        # Pickle GLOBAL references found in checkpoint:
        #   omegaconf.dictconfig.DictConfig
        #   omegaconf.listconfig.ListConfig
        #   omegaconf.nodes.AnyNode
        #   omegaconf.base.ContainerMetadata
        #   omegaconf.base.Metadata
        _DummyOmega = type("_DummyOmega", (), {
            "__reduce__": lambda self: (dict, ()),
            "__setstate__": lambda self, state: None,
        })

        oc_modules = {
            "omegaconf": {},
            "omegaconf.base": {
                "ContainerMetadata": _DummyOmega,
                "Metadata": _DummyOmega,
            },
            "omegaconf.dictconfig": {
                "DictConfig": _DummyOmega,
            },
            "omegaconf.listconfig": {
                "ListConfig": _DummyOmega,
            },
            "omegaconf.nodes": {
                "AnyNode": _DummyOmega,
            },
        }

        all_mocks = {**pl_modules, **oc_modules}

        for mod_name, attrs in all_mocks.items():
            if mod_name not in sys_module.modules:
                mod = types.ModuleType(mod_name)
                for attr_name, attr_val in attrs.items():
                    setattr(mod, attr_name, attr_val)
                sys_module.modules[mod_name] = mod
                mocked.append(mod_name)

        return mocked

    @staticmethod
    def _cleanup_pickle_mocks(sys_module, mocked: list[str]) -> None:
        """Remove mock modules installed for pickle deserialization."""
        for mod_name in reversed(mocked):
            sys_module.modules.pop(mod_name, None)

    def _load_model(self) -> nn.Module:
        """Load FFCResNetGenerator from Er0mangaInpaint checkpoint (auto-downloaded from HF)."""
        logger.info(f"📥 Resolving model files from {HF_REPO_ID}...")
        config_path = hf_hub_download(repo_id=HF_REPO_ID, filename="config.yaml")
        ckpt_path = hf_hub_download(repo_id=HF_REPO_ID, filename="models/best.ckpt")
        logger.info(f"📁 Config: {config_path}")
        logger.info(f"📁 Checkpoint: {ckpt_path}")

        # Load and resolve config
        with open(config_path, "r") as f:
            raw_config = yaml.safe_load(f)

        config = _resolve_omegaconf_refs(raw_config)
        gen_cfg = config["generator"]

        logger.info(
            f"📐 Generator config: kind={gen_cfg['kind']}, "
            f"n_blocks={gen_cfg.get('n_blocks', 9)}, "
            f"ngf={gen_cfg.get('ngf', 64)}, "
            f"n_downsampling={gen_cfg.get('n_downsampling', 3)}"
        )

        # Build generator
        generator = FFCResNetGenerator(
            input_nc=gen_cfg["input_nc"],
            output_nc=gen_cfg["output_nc"],
            ngf=gen_cfg.get("ngf", 64),
            n_downsampling=gen_cfg.get("n_downsampling", 3),
            n_blocks=gen_cfg.get("n_blocks", 9),
            add_out_act=gen_cfg.get("add_out_act", "sigmoid"),
            init_conv_kwargs=gen_cfg.get("init_conv_kwargs", {}),
            downsample_conv_kwargs=gen_cfg.get("downsample_conv_kwargs", {}),
            resnet_conv_kwargs=gen_cfg.get("resnet_conv_kwargs", {}),
        )

        # Load checkpoint (PyTorch Lightning format: state_dict with generator.* prefix)
        # The checkpoint was saved by PyTorch Lightning, so pickle needs the module
        # registered. We mock it to avoid installing the full pytorch_lightning package.
        import sys
        import types
        _mocks_installed = self._install_pickle_mocks(sys)

        logger.info(f"📦 Loading checkpoint: {ckpt_path}")
        ckpt = torch.load(ckpt_path, map_location=self.device, weights_only=False)

        # Clean up mock modules
        self._cleanup_pickle_mocks(sys, _mocks_installed)

        state_dict = ckpt.get("state_dict", ckpt)
        gen_state = {
            k.replace("generator.", "", 1): v
            for k, v in state_dict.items()
            if k.startswith("generator.")
        }

        missing, unexpected = generator.load_state_dict(gen_state, strict=False)
        if missing:
            logger.warning(f"⚠️ Missing keys: {len(missing)}")
        if unexpected:
            logger.warning(f"⚠️ Unexpected keys: {len(unexpected)}")

        generator.to(self.device)
        generator.eval()

        # Count parameters
        n_params = sum(p.numel() for p in generator.parameters()) / 1e6
        logger.info(f"✅ Generator loaded: {n_params:.1f}M parameters")

        return generator

    def __call__(self, image: Image.Image, mask: Image.Image) -> Image.Image:
        """
        Inpaint masked regions of an image.

        Forward pass matches DefaultInpaintingTrainingModule:
            masked_img = img * (1 - mask)
            input = cat([masked_img, mask], dim=1)
            predicted = generator(input)
            result = mask * predicted + (1 - mask) * img

        Args:
            image: RGB PIL Image (the region to clean)
            mask: Grayscale PIL Image (white=text to remove, black=keep)

        Returns:
            Inpainted RGB PIL Image (same dimensions as input)
        """
        orig_w, orig_h = image.size

        # Convert to float32 [0,1] tensors
        img_np = np.array(image.convert("RGB")).astype(np.float32) / 255.0
        mask_np = np.array(mask.convert("L")).astype(np.float32) / 255.0

        # Binarize mask: white (>0) = 1.0 (inpaint), black = 0.0 (keep)
        mask_np = (mask_np > 0).astype(np.float32)

        # HWC → CHW, add batch dimension
        img_t = torch.from_numpy(img_np).permute(2, 0, 1).unsqueeze(0)   # (1, 3, H, W)
        mask_t = torch.from_numpy(mask_np).unsqueeze(0).unsqueeze(0)      # (1, 1, H, W)

        # Pad to multiple of 8 (required by 3x downsampling with stride 2)
        _, _, h, w = img_t.shape
        pad_h = (8 - h % 8) % 8
        pad_w = (8 - w % 8) % 8
        if pad_h > 0 or pad_w > 0:
            img_t = F.pad(img_t, (0, pad_w, 0, pad_h), mode="reflect")
            mask_t = F.pad(mask_t, (0, pad_w, 0, pad_h), mode="reflect")

        img_t = img_t.to(self.device)
        mask_t = mask_t.to(self.device)

        # Forward pass (Er0mangaInpaint / LaMa convention)
        masked_img = img_t * (1 - mask_t)
        input_t = torch.cat([masked_img, mask_t], dim=1)  # (1, 4, H, W)

        with torch.inference_mode():
            predicted = self.generator(input_t)

        # Composite: predicted in masked area, original everywhere else
        result = mask_t * predicted + (1 - mask_t) * img_t

        # Remove padding, convert back to PIL
        result = result[0, :, :orig_h, :orig_w]   # (3, H, W)
        result = result.clamp(0, 1).permute(1, 2, 0).cpu().numpy()
        result = (result * 255).astype(np.uint8)

        return Image.fromarray(result, mode="RGB")
