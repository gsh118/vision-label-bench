from __future__ import annotations

import hashlib
import io

from fastapi.testclient import TestClient
from PIL import Image

from lb_tool.app import _is_local_client, create_app
from lb_tool.adapters.base import PredictionBatch
from lb_tool.schemas import Detection, ModelInfo


def test_health_reports_optional_adapter_state() -> None:
    client = TestClient(create_app())
    response = client.get("/api/health")
    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "ok"
    assert set(payload["adapters"]) == {"yolo", "detr"}


def test_infer_rejects_non_image_before_loading_model() -> None:
    client = TestClient(create_app())
    response = client.post(
        "/api/infer",
        data={"model_ref": "yolo11n.pt"},
        files={"image": ("notes.txt", b"not an image", "text/plain")},
    )
    assert response.status_code == 400
    assert "이미지" in response.json()["detail"]


def test_model_browser_lists_directories_and_model_files_only(tmp_path) -> None:
    (tmp_path / "weights").mkdir()
    (tmp_path / "best.pt").write_bytes(b"model")
    (tmp_path / "detector.onnx").write_bytes(b"onnx")
    (tmp_path / "preview.jpg").write_bytes(b"image")
    (tmp_path / "notes.txt").write_text("hidden")

    client = TestClient(create_app())
    response = client.get("/api/models/browse", params={"path": str(tmp_path)})

    assert response.status_code == 200
    payload = response.json()
    entries = {entry["name"]: entry for entry in payload["entries"]}
    assert set(entries) == {"weights", "best.pt", "detector.onnx"}
    assert entries["weights"]["kind"] == "directory"
    assert entries["best.pt"]["kind"] == "model"
    assert entries["best.pt"]["size"] == 5
    assert payload["parent"]
    assert payload["roots"]


def test_model_browser_returns_not_found_for_missing_path(tmp_path) -> None:
    client = TestClient(create_app())
    response = client.get("/api/models/browse", params={"path": str(tmp_path / "missing")})
    assert response.status_code == 404


def test_model_browser_local_client_guard() -> None:
    assert _is_local_client("127.0.0.1")
    assert _is_local_client("::1")
    assert _is_local_client("::ffff:127.0.0.1")
    assert not _is_local_client("192.168.10.24")
    assert not _is_local_client("labeler.example.com")
    assert not _is_local_client(None)


class _ModelInfoRegistry:
    def load(self, spec):
        return (
            ModelInfo(
                adapter="yolo",
                model_ref=spec.model_ref,
                device="cuda:0",
                classes={0: "person", 5: "bus"},
                model_type="yolo11n",
                architecture="DetectionModel",
                task="detect",
                format="PT",
                runtime_version="8.4.92",
                input_size="640 × 640",
                parameter_count=2_624_080,
                file_size=5_613_764,
            ),
            False,
        )


def test_model_load_returns_detailed_metadata() -> None:
    client = TestClient(create_app(registry=_ModelInfoRegistry()))
    response = client.post(
        "/api/models/load",
        json={"adapter": "yolo", "model_ref": "yolo11n.pt", "device": "cuda"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["cached"] is False
    assert payload["load_time_ms"] >= 0
    assert payload["model"]["architecture"] == "DetectionModel"
    assert payload["model"]["parameter_count"] == 2_624_080
    assert payload["model"]["classes"] == {"0": "person", "5": "bus"}


class _InferenceRegistry:
    def __init__(self, adapter: str = "yolo") -> None:
        self.adapter = adapter
        self.image = None

    def predict(self, spec, image, confidence, iou):
        self.image = image
        model = ModelInfo(
            adapter=self.adapter,
            model_ref=spec.model_ref,
            device="cuda:0",
            classes={5: "connector"},
            model_type="test-detector",
            architecture="TestModel",
            task="detect",
            format="PT" if self.adapter == "yolo" else "HUGGING FACE",
            runtime_version="1.2.3",
            input_size="640 × 640",
        )
        detections = [] if self.adapter == "detr" else [
            Detection(
                class_id=5,
                label="connector",
                score=0.73,
                x1=0,
                y1=0,
                x2=image.width,
                y2=image.height,
            )
        ]
        return model, PredictionBatch(image.width, image.height, detections)


def _oriented_jpeg() -> bytes:
    image = Image.new("L", (4, 2), color=137)
    exif = Image.Exif()
    exif[274] = 6
    output = io.BytesIO()
    image.save(output, format="JPEG", exif=exif)
    return output.getvalue()


def test_infer_returns_reproducible_trace_and_applies_exif_rgb_pipeline() -> None:
    registry = _InferenceRegistry()
    client = TestClient(create_app(registry=registry))
    image_bytes = _oriented_jpeg()

    response = client.post(
        "/api/infer",
        data={
            "adapter": "yolo",
            "model_ref": "best.pt",
            "device": "auto",
            "confidence": "0.31",
            "iou": "0.55",
        },
        files={"image": ("oriented.jpg", image_bytes, "image/jpeg")},
    )

    assert response.status_code == 200
    payload = response.json()
    trace = payload["trace"]
    assert registry.image.mode == "RGB"
    assert registry.image.size == (2, 4)
    assert trace["image_sha256"] == hashlib.sha256(image_bytes).hexdigest()
    assert (trace["source_width"], trace["source_height"]) == (4, 2)
    assert (trace["processed_width"], trace["processed_height"]) == (2, 4)
    assert trace["source_color_mode"] == "L"
    assert trace["processed_color_mode"] == "RGB"
    assert trace["exif_orientation"] == 6
    assert trace["exif_transposed"] is True
    assert trace["confidence"] == 0.31
    assert trace["iou"] == 0.55
    assert trace["nms_applied"] is True
    assert trace["detection_count"] == 1
    assert trace["class_counts"] == {"5": 1}
    assert trace["score_min"] == trace["score_max"] == trace["score_mean"] == 0.73


def test_detr_trace_marks_nms_as_not_applied() -> None:
    client = TestClient(create_app(registry=_InferenceRegistry(adapter="detr")))
    image_bytes = _oriented_jpeg()
    response = client.post(
        "/api/infer",
        data={"adapter": "detr", "model_ref": "facebook/detr-resnet-50", "iou": "0.88"},
        files={"image": ("sample.jpg", image_bytes, "image/jpeg")},
    )

    assert response.status_code == 200
    trace = response.json()["trace"]
    assert trace["nms_applied"] is False
    assert trace["iou"] is None
    assert trace["detection_count"] == 0
    assert trace["score_mean"] is None
