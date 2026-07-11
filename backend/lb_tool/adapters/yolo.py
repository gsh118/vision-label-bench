from __future__ import annotations

from typing import Any

from PIL import Image

from lb_tool.adapters.base import (
    AdapterDependencyError,
    count_parameters,
    Detector,
    DetectorError,
    local_model_size,
    model_format,
    PredictionBatch,
)
from lb_tool.schemas import Detection, ModelInfo, ModelSpec


class YoloDetector(Detector):
    def __init__(self, spec: ModelSpec) -> None:
        super().__init__(spec)
        try:
            import torch
            from ultralytics import YOLO, __version__ as ultralytics_version
        except ImportError as exc:
            raise AdapterDependencyError(
                "YOLO 런타임이 설치되지 않았습니다. `uv sync --extra yolo`를 실행하세요."
            ) from exc

        if spec.device.value == "cuda" and not torch.cuda.is_available():
            raise DetectorError("CUDA를 선택했지만 PyTorch에서 CUDA 장치를 찾지 못했습니다.")

        self._device: Any
        if spec.device.value == "auto":
            self._device = 0 if torch.cuda.is_available() else "cpu"
        elif spec.device.value == "cuda":
            self._device = 0
        else:
            self._device = "cpu"

        try:
            self._model = YOLO(spec.model_ref)
        except Exception as exc:
            raise DetectorError(f"YOLO 모델을 불러오지 못했습니다: {exc}") from exc

        names = getattr(self._model, "names", {}) or {}
        self._classes = _normalise_names(names)
        core_model = getattr(self._model, "model", None)
        overrides = getattr(self._model, "overrides", {}) or {}
        model_args = getattr(core_model, "args", {}) or {}
        image_size = overrides.get("imgsz") or model_args.get("imgsz") or 640
        self._metadata = {
            "model_type": _model_name(spec.model_ref),
            "architecture": core_model.__class__.__name__ if core_model is not None else None,
            "task": str(getattr(self._model, "task", None) or "detect"),
            "format": model_format(spec.model_ref, "ULTRALYTICS"),
            "runtime_version": str(ultralytics_version),
            "input_size": _format_image_size(image_size),
            "parameter_count": count_parameters(core_model),
            "file_size": local_model_size(spec.model_ref),
        }

    @property
    def info(self) -> ModelInfo:
        return ModelInfo(
            adapter="yolo",
            model_ref=self.spec.model_ref,
            device="cuda:0" if self._device == 0 else "cpu",
            classes=self._classes,
            **self._metadata,
        )

    def predict(self, image: Image.Image, confidence: float, iou: float) -> PredictionBatch:
        try:
            results = self._model.predict(
                # Ultralytics expects PIL images in RGB, while NumPy arrays are BGR.
                # Keep the PIL object intact so its loader performs the correct conversion.
                source=image,
                conf=confidence,
                iou=iou,
                device=self._device,
                verbose=False,
            )
        except Exception as exc:
            raise DetectorError(f"YOLO 추론에 실패했습니다: {exc}") from exc

        if not results:
            return PredictionBatch(image.width, image.height, [])

        result = results[0].cpu()
        names = _normalise_names(getattr(result, "names", self._classes))
        self._classes = names or self._classes
        if result.boxes is None:
            return PredictionBatch(image.width, image.height, [])

        coords = result.boxes.xyxy.tolist()
        scores = result.boxes.conf.tolist()
        class_ids = [int(value) for value in result.boxes.cls.tolist()]
        detections = [
            Detection(
                class_id=class_id,
                label=self._classes.get(class_id, str(class_id)),
                score=float(score),
                x1=max(0.0, float(box[0])),
                y1=max(0.0, float(box[1])),
                x2=min(float(image.width), float(box[2])),
                y2=min(float(image.height), float(box[3])),
            )
            for box, score, class_id in zip(coords, scores, class_ids, strict=True)
            if box[2] > box[0] and box[3] > box[1]
        ]
        return PredictionBatch(image.width, image.height, detections)


def _normalise_names(names: Any) -> dict[int, str]:
    if isinstance(names, dict):
        return {int(key): str(value) for key, value in names.items()}
    if isinstance(names, (list, tuple)):
        return {index: str(value) for index, value in enumerate(names)}
    return {}


def _model_name(model_ref: str) -> str:
    from pathlib import Path

    name = Path(model_ref).stem
    return name if name and name != "." else "YOLO"


def _format_image_size(value: Any) -> str:
    if isinstance(value, (list, tuple)):
        return " × ".join(str(item) for item in value)
    return f"{value} × {value}"
