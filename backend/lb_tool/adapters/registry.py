from __future__ import annotations

from collections import OrderedDict
from dataclasses import dataclass
from threading import RLock

from PIL import Image

from lb_tool.adapters.base import Detector, PredictionBatch
from lb_tool.adapters.detr import DetrDetector
from lb_tool.adapters.yolo import YoloDetector
from lb_tool.schemas import AdapterKind, ModelInfo, ModelSpec


@dataclass
class _LoadedDetector:
    detector: Detector
    lock: RLock


class DetectorRegistry:
    """Small LRU cache that keeps model loading separate from request handling."""

    def __init__(self, max_models: int = 2) -> None:
        self._max_models = max_models
        self._models: OrderedDict[str, _LoadedDetector] = OrderedDict()
        self._lock = RLock()

    def load(self, spec: ModelSpec) -> tuple[ModelInfo, bool]:
        entry, cached = self._get_or_create(spec)
        return entry.detector.info, cached

    def predict(
        self,
        spec: ModelSpec,
        image: Image.Image,
        confidence: float,
        iou: float,
    ) -> tuple[ModelInfo, PredictionBatch]:
        entry, _ = self._get_or_create(spec)
        with entry.lock:
            batch = entry.detector.predict(image, confidence, iou)
        return entry.detector.info, batch

    def clear(self) -> None:
        with self._lock:
            self._models.clear()

    def _get_or_create(self, spec: ModelSpec) -> tuple[_LoadedDetector, bool]:
        resolved = spec.model_copy(update={"adapter": resolve_adapter(spec)})
        key = resolved.model_dump_json()
        with self._lock:
            if key in self._models:
                self._models.move_to_end(key)
                return self._models[key], True

            detector: Detector
            if resolved.adapter == AdapterKind.YOLO:
                detector = YoloDetector(resolved)
            else:
                detector = DetrDetector(resolved)
            entry = _LoadedDetector(detector=detector, lock=RLock())
            self._models[key] = entry
            self._models.move_to_end(key)
            while len(self._models) > self._max_models:
                self._models.popitem(last=False)
            return entry, False


def resolve_adapter(spec: ModelSpec) -> AdapterKind:
    if spec.adapter != AdapterKind.AUTO:
        return spec.adapter
    reference = spec.model_ref.lower().replace("\\", "/")
    if "detr" in reference or "conditional-detr" in reference:
        return AdapterKind.DETR
    return AdapterKind.YOLO
