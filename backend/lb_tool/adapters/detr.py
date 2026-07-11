from __future__ import annotations

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


class DetrDetector(Detector):
    def __init__(self, spec: ModelSpec) -> None:
        super().__init__(spec)
        try:
            import torch
            from transformers import (
                AutoImageProcessor,
                AutoModelForObjectDetection,
                __version__ as transformers_version,
            )
        except ImportError as exc:
            raise AdapterDependencyError(
                "DETR 런타임이 설치되지 않았습니다. `uv sync --extra detr`를 실행하세요."
            ) from exc

        if spec.device.value == "cuda" and not torch.cuda.is_available():
            raise DetectorError("CUDA를 선택했지만 PyTorch에서 CUDA 장치를 찾지 못했습니다.")

        self._torch = torch
        self._device = "cuda:0" if (
            spec.device.value == "cuda"
            or (spec.device.value == "auto" and torch.cuda.is_available())
        ) else "cpu"
        try:
            self._processor = AutoImageProcessor.from_pretrained(spec.model_ref)
            self._model = AutoModelForObjectDetection.from_pretrained(spec.model_ref)
            self._model.to(self._device)
            self._model.eval()
        except Exception as exc:
            raise DetectorError(f"DETR 모델을 불러오지 못했습니다: {exc}") from exc

        labels = getattr(self._model.config, "id2label", {}) or {}
        self._classes = {int(key): str(value) for key, value in labels.items()}
        config = self._model.config
        architectures = getattr(config, "architectures", None) or []
        self._metadata = {
            "model_type": str(getattr(config, "model_type", None) or "detr"),
            "architecture": str(architectures[0]) if architectures else self._model.__class__.__name__,
            "task": "object-detection",
            "format": model_format(spec.model_ref, "HUGGING FACE"),
            "runtime_version": str(transformers_version),
            "input_size": _format_processor_size(getattr(self._processor, "size", None)),
            "parameter_count": count_parameters(self._model),
            "file_size": local_model_size(spec.model_ref),
        }

    @property
    def info(self) -> ModelInfo:
        return ModelInfo(
            adapter="detr",
            model_ref=self.spec.model_ref,
            device=self._device,
            classes=self._classes,
            **self._metadata,
        )

    def predict(self, image: Image.Image, confidence: float, iou: float) -> PredictionBatch:
        del iou  # DETR does not use NMS IoU in the standard post-processor.
        try:
            inputs = self._processor(images=image, return_tensors="pt")
            inputs = {key: value.to(self._device) for key, value in inputs.items()}
            with self._torch.inference_mode():
                outputs = self._model(**inputs)
            target_sizes = self._torch.tensor([[image.height, image.width]], device=self._device)
            result = self._processor.post_process_object_detection(
                outputs,
                threshold=confidence,
                target_sizes=target_sizes,
            )[0]
        except Exception as exc:
            raise DetectorError(f"DETR 추론에 실패했습니다: {exc}") from exc

        boxes = result["boxes"].detach().cpu().tolist()
        scores = result["scores"].detach().cpu().tolist()
        labels = [int(value) for value in result["labels"].detach().cpu().tolist()]
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
            for box, score, class_id in zip(boxes, scores, labels, strict=True)
            if box[2] > box[0] and box[3] > box[1]
        ]
        return PredictionBatch(image.width, image.height, detections)


def _format_processor_size(size: object) -> str | None:
    if size is None:
        return None
    values: dict[str, object] = {}
    items = getattr(size, "items", None)
    if callable(items):
        values = {str(key): value for key, value in items() if value is not None}
    else:
        for key in ("height", "width", "shortest_edge", "longest_edge"):
            value = getattr(size, key, None)
            if value is not None:
                values[key] = value
    if values.get("height") and values.get("width"):
        return f"{values['height']} × {values['width']}"
    labels = {
        "shortest_edge": "shortest",
        "longest_edge": "longest",
        "height": "height",
        "width": "width",
    }
    ordered_keys = [key for key in ("shortest_edge", "longest_edge", "height", "width") if key in values]
    ordered_keys.extend(key for key in values if key not in ordered_keys)
    parts = [
        f"{labels.get(key, key.replace('_', ' '))} {values[key]}"
        for key in ordered_keys
    ]
    return " · ".join(parts) or str(size)
