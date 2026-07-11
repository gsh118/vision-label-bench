from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from PIL import Image

from lb_tool.schemas import Detection, ModelInfo, ModelSpec


class DetectorError(RuntimeError):
    """User-facing detector failure."""


class AdapterDependencyError(DetectorError):
    """Raised when an optional model runtime is not installed."""


@dataclass(frozen=True)
class PredictionBatch:
    width: int
    height: int
    detections: list[Detection]


class Detector(ABC):
    def __init__(self, spec: ModelSpec) -> None:
        self.spec = spec

    @property
    @abstractmethod
    def info(self) -> ModelInfo:
        raise NotImplementedError

    @abstractmethod
    def predict(self, image: Image.Image, confidence: float, iou: float) -> PredictionBatch:
        raise NotImplementedError


def count_parameters(model: Any) -> int | None:
    parameters = getattr(model, "parameters", None)
    if not callable(parameters):
        return None
    try:
        return sum(int(parameter.numel()) for parameter in parameters())
    except (AttributeError, TypeError):
        return None


def local_model_size(model_ref: str) -> int | None:
    path = Path(model_ref).expanduser()
    try:
        if path.is_file():
            return path.stat().st_size
        if path.is_dir():
            model_suffixes = {".bin", ".ckpt", ".onnx", ".pt", ".pth", ".safetensors"}
            return sum(
                item.stat().st_size
                for item in path.rglob("*")
                if item.is_file() and item.suffix.lower() in model_suffixes
            )
    except OSError:
        return None
    return None


def model_format(model_ref: str, fallback: str) -> str:
    path = Path(model_ref).expanduser()
    if path.suffix:
        return path.suffix.removeprefix(".").upper()
    if path.is_dir():
        return "DIRECTORY"
    return fallback
