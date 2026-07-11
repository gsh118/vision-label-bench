from __future__ import annotations

import base64
import io
import json
import zipfile

from lb_tool.exporters import build_export_archive
from lb_tool.schemas import ExportAnnotation, ExportFormat, ExportImage, ExportRequest


def make_request(export_format: ExportFormat) -> ExportRequest:
    return ExportRequest(
        format=export_format,
        classes={0: "person", 3: "helmet"},
        include_confidence=True,
        images=[
            ExportImage(
                filename="현장 사진.jpg",
                width=1000,
                height=500,
                annotations=[
                    ExportAnnotation(
                        class_id=3,
                        label="helmet",
                        score=0.8732,
                        x1=100,
                        y1=50,
                        x2=300,
                        y2=150,
                    )
                ],
            )
        ],
    )


def read_archive(payload: bytes) -> zipfile.ZipFile:
    return zipfile.ZipFile(io.BytesIO(payload))


def test_yolo_export_normalises_coordinates_and_keeps_class_id() -> None:
    with read_archive(build_export_archive(make_request(ExportFormat.YOLO))) as archive:
        line = archive.read("labels/train/현장_사진.txt").decode().strip()
        assert line == "3 0.200000 0.200000 0.200000 0.200000 0.873200"
        assert '3: "helmet"' in archive.read("data.yaml").decode()


def test_yolo_export_preserves_split_relative_paths_and_original_images() -> None:
    request = make_request(ExportFormat.YOLO)
    request.include_original_images = True
    request.images[0].split = "val"
    request.images[0].relative_path = "images/val/site-a/frame.jpg"
    request.images[0].image_data = "data:image/jpeg;base64," + base64.b64encode(b"jpeg-bytes").decode()
    with read_archive(build_export_archive(request)) as archive:
        assert archive.read("images/val/site-a/frame.jpg") == b"jpeg-bytes"
        assert archive.read("labels/val/site-a/frame.txt").decode().startswith("3 ")
        assert "val: images/val" in archive.read("data.yaml").decode()


def test_coco_export_uses_xywh_and_area() -> None:
    with read_archive(build_export_archive(make_request(ExportFormat.COCO))) as archive:
        payload = json.loads(archive.read("annotations.json"))
        annotation = payload["annotations"][0]
        assert annotation["bbox"] == [100.0, 50.0, 200.0, 100.0]
        assert annotation["area"] == 20000.0
        assert annotation["category_id"] == 3


def test_voc_export_contains_image_and_object_metadata() -> None:
    with read_archive(build_export_archive(make_request(ExportFormat.VOC))) as archive:
        xml = archive.read("annotations/현장_사진.xml").decode()
        assert "<filename>현장 사진.jpg</filename>" in xml
        assert "<name>helmet</name>" in xml
        assert "<xmin>100</xmin>" in xml
