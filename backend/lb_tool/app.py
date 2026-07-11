from __future__ import annotations

import importlib.util
import ipaddress
import io
import time
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, Query, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from fastapi.staticfiles import StaticFiles
from PIL import Image, UnidentifiedImageError

from lb_tool import __version__
from lb_tool.adapters import DetectorRegistry
from lb_tool.adapters.base import DetectorError
from lb_tool.exporters import build_export_archive
from lb_tool.model_files import browse_model_files
from lb_tool.schemas import (
    AdapterKind,
    DeviceKind,
    ExportRequest,
    InferenceResponse,
    ModelBrowseResponse,
    ModelLoadResponse,
    ModelSpec,
)

MAX_UPLOAD_BYTES = 50 * 1024 * 1024
MAX_IMAGE_PIXELS = 120_000_000


def create_app(registry: DetectorRegistry | None = None) -> FastAPI:
    app = FastAPI(title="Label Bench API", version=__version__)
    app.state.registry = registry or DetectorRegistry()
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://127.0.0.1:5173", "http://localhost:5173"],
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.get("/api/health")
    def health() -> dict[str, object]:
        return {
            "status": "ok",
            "version": __version__,
            "adapters": {
                "yolo": importlib.util.find_spec("ultralytics") is not None,
                "detr": importlib.util.find_spec("transformers") is not None,
            },
            "device": _device_info(),
        }

    @app.post("/api/models/load", response_model=ModelLoadResponse)
    def load_model(spec: ModelSpec) -> ModelLoadResponse:
        started = time.perf_counter()
        try:
            model, cached = app.state.registry.load(spec)
        except DetectorError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        return ModelLoadResponse(
            model=model,
            load_time_ms=(time.perf_counter() - started) * 1000,
            cached=cached,
        )

    @app.get("/api/models/browse", response_model=ModelBrowseResponse)
    def browse_models(
        request: Request,
        path: str | None = Query(default=None, max_length=4096),
    ) -> ModelBrowseResponse:
        if not _is_local_client(request.client.host if request.client else None):
            raise HTTPException(
                status_code=403,
                detail="모델 파일 탐색은 이 컴퓨터에서 접속할 때만 사용할 수 있습니다.",
            )
        try:
            return browse_model_files(path)
        except FileNotFoundError as exc:
            raise HTTPException(status_code=404, detail="경로를 찾을 수 없습니다.") from exc
        except PermissionError as exc:
            raise HTTPException(status_code=403, detail="이 폴더를 읽을 권한이 없습니다.") from exc
        except OSError as exc:
            raise HTTPException(status_code=422, detail=f"폴더를 열지 못했습니다: {exc}") from exc

    @app.post("/api/infer", response_model=InferenceResponse)
    def infer(
        image: UploadFile = File(...),
        adapter: AdapterKind = Form(AdapterKind.AUTO),
        model_ref: str = Form(..., min_length=1, max_length=1024),
        device: DeviceKind = Form(DeviceKind.AUTO),
        confidence: float = Form(0.25, ge=0.01, le=1.0),
        iou: float = Form(0.7, ge=0.01, le=1.0),
    ) -> InferenceResponse:
        pil_image = _read_image(image)
        spec = ModelSpec(adapter=adapter, model_ref=model_ref, device=device)
        started = time.perf_counter()
        try:
            model, batch = app.state.registry.predict(spec, pil_image, confidence, iou)
        except DetectorError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        elapsed_ms = (time.perf_counter() - started) * 1000
        return InferenceResponse(
            width=batch.width,
            height=batch.height,
            elapsed_ms=elapsed_ms,
            model=model,
            detections=batch.detections,
        )

    @app.post("/api/export")
    def export_annotations(request: ExportRequest) -> Response:
        archive = build_export_archive(request)
        filename = f"label-bench-{request.format.value}.zip"
        return Response(
            content=archive,
            media_type="application/zip",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )

    frontend_dist = Path(__file__).resolve().parents[2] / "frontend" / "dist"
    if frontend_dist.is_dir():
        app.mount("/", StaticFiles(directory=frontend_dist, html=True), name="frontend")
    else:
        @app.get("/")
        def root() -> dict[str, str]:
            return {
                "message": "Label Bench API is running. Start the frontend with `npm run dev`."
            }

    return app


def _read_image(upload: UploadFile) -> Image.Image:
    data = upload.file.read(MAX_UPLOAD_BYTES + 1)
    if not data:
        raise HTTPException(status_code=400, detail="빈 이미지 파일입니다.")
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="이미지는 50MB 이하여야 합니다.")
    try:
        image = Image.open(io.BytesIO(data))
        image.load()
        if image.width * image.height > MAX_IMAGE_PIXELS:
            raise HTTPException(status_code=413, detail="이미지 해상도가 너무 큽니다.")
        return image.convert("RGB")
    except (UnidentifiedImageError, OSError) as exc:
        raise HTTPException(status_code=400, detail="지원되는 이미지 파일이 아닙니다.") from exc


def _device_info() -> dict[str, object]:
    try:
        import torch

        available = bool(torch.cuda.is_available())
        return {
            "cuda": available,
            "name": torch.cuda.get_device_name(0) if available else None,
        }
    except ImportError:
        return {"cuda": False, "name": None}


def _is_local_client(host: str | None) -> bool:
    if host in {"localhost", "testclient"}:
        return True
    if not host:
        return False
    try:
        address = ipaddress.ip_address(host)
        mapped = getattr(address, "ipv4_mapped", None)
        return address.is_loopback or bool(mapped and mapped.is_loopback)
    except ValueError:
        return False


app = create_app()
