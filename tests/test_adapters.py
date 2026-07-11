from __future__ import annotations

from PIL import Image

from lb_tool.adapters.detr import _format_processor_size
from lb_tool.adapters.yolo import YoloDetector


def test_detr_processor_size_formats_edge_constraints() -> None:
    size = {
        "height": None,
        "width": None,
        "longest_edge": 1333,
        "shortest_edge": 800,
    }
    assert _format_processor_size(size) == "shortest 800 · longest 1333"


def test_detr_processor_size_formats_fixed_dimensions() -> None:
    assert _format_processor_size({"height": 640, "width": 640}) == "640 × 640"


class _EmptyYoloResult:
    boxes = None
    names: dict[int, str] = {}

    def cpu(self):
        return self


class _CapturingYoloModel:
    def __init__(self) -> None:
        self.source = None

    def predict(self, *, source, **kwargs):
        self.source = source
        return [_EmptyYoloResult()]


def test_yolo_predict_preserves_rgb_pil_input() -> None:
    detector = object.__new__(YoloDetector)
    detector._model = _CapturingYoloModel()
    detector._device = "cpu"
    detector._classes = {}
    image = Image.new("RGB", (32, 24), color=(219, 41, 73))

    result = detector.predict(image, confidence=0.25, iou=0.7)

    assert detector._model.source is image
    assert detector._model.source.mode == "RGB"
    assert detector._model.source.getpixel((0, 0)) == (219, 41, 73)
    assert (result.width, result.height) == (32, 24)
