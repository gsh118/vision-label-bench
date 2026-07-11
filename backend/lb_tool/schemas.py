from __future__ import annotations

from enum import StrEnum
from typing import Literal

from pydantic import BaseModel, Field, model_validator


class AdapterKind(StrEnum):
    AUTO = "auto"
    YOLO = "yolo"
    DETR = "detr"


class DeviceKind(StrEnum):
    AUTO = "auto"
    CPU = "cpu"
    CUDA = "cuda"


class ModelSpec(BaseModel):
    adapter: AdapterKind = AdapterKind.AUTO
    model_ref: str = Field(min_length=1, max_length=1024)
    device: DeviceKind = DeviceKind.AUTO


class ModelInfo(BaseModel):
    adapter: Literal["yolo", "detr"]
    model_ref: str
    device: str
    classes: dict[int, str]
    model_type: str | None = None
    architecture: str | None = None
    task: str | None = None
    format: str | None = None
    runtime_version: str | None = None
    input_size: str | None = None
    parameter_count: int | None = Field(default=None, ge=0)
    file_size: int | None = Field(default=None, ge=0)


class ModelLoadResponse(BaseModel):
    model: ModelInfo
    load_time_ms: float = Field(ge=0)
    cached: bool


class ModelBrowseEntry(BaseModel):
    name: str
    path: str
    kind: Literal["directory", "model"]
    size: int | None = None


class ModelBrowseResponse(BaseModel):
    current: str
    parent: str | None
    home: str
    roots: list[str]
    entries: list[ModelBrowseEntry]


class Detection(BaseModel):
    class_id: int = Field(ge=0)
    label: str
    score: float = Field(ge=0, le=1)
    x1: float
    y1: float
    x2: float
    y2: float

    @model_validator(mode="after")
    def validate_corners(self) -> "Detection":
        if self.x2 <= self.x1 or self.y2 <= self.y1:
            raise ValueError("Detection must have positive width and height")
        return self


class InferenceTrace(BaseModel):
    image_name: str
    image_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    content_type: str | None = None
    source_width: int = Field(gt=0)
    source_height: int = Field(gt=0)
    processed_width: int = Field(gt=0)
    processed_height: int = Field(gt=0)
    source_color_mode: str
    processed_color_mode: Literal["RGB"] = "RGB"
    exif_orientation: int | None = None
    exif_transposed: bool
    preprocessing: str
    configured_input_size: str | None = None
    confidence: float = Field(ge=0, le=1)
    iou: float | None = Field(default=None, ge=0, le=1)
    nms_applied: bool
    requested_device: DeviceKind
    resolved_device: str
    detection_count: int = Field(ge=0)
    class_counts: dict[int, int]
    score_min: float | None = Field(default=None, ge=0, le=1)
    score_max: float | None = Field(default=None, ge=0, le=1)
    score_mean: float | None = Field(default=None, ge=0, le=1)


class InferenceResponse(BaseModel):
    width: int = Field(gt=0)
    height: int = Field(gt=0)
    elapsed_ms: float = Field(ge=0)
    model: ModelInfo
    detections: list[Detection]
    trace: InferenceTrace


class ExportFormat(StrEnum):
    YOLO = "yolo"
    COCO = "coco"
    VOC = "voc"


class ExportAnnotation(BaseModel):
    class_id: int = Field(ge=0)
    label: str = Field(min_length=1, max_length=256)
    score: float | None = Field(default=None, ge=0, le=1)
    x1: float
    y1: float
    x2: float
    y2: float

    @model_validator(mode="after")
    def validate_corners(self) -> "ExportAnnotation":
        if self.x2 <= self.x1 or self.y2 <= self.y1:
            raise ValueError("Annotation must have positive width and height")
        return self


class ExportImage(BaseModel):
    filename: str = Field(min_length=1, max_length=1024)
    relative_path: str | None = Field(default=None, max_length=2048)
    split: Literal["train", "val", "test", "unspecified"] = "unspecified"
    image_data: str | None = None
    width: int = Field(gt=0)
    height: int = Field(gt=0)
    annotations: list[ExportAnnotation] = Field(default_factory=list)


class ExportRequest(BaseModel):
    format: ExportFormat
    images: list[ExportImage] = Field(min_length=1)
    classes: dict[int, str]
    include_confidence: bool = False
    include_original_images: bool = False

    @model_validator(mode="after")
    def validate_original_images(self) -> "ExportRequest":
        if self.include_original_images and any(not image.image_data for image in self.images):
            raise ValueError("Original image data is required when include_original_images is enabled")
        return self
