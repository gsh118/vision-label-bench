from __future__ import annotations

from fastapi.testclient import TestClient

from lb_tool.app import _is_local_client, create_app
from lb_tool.schemas import ModelInfo


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
