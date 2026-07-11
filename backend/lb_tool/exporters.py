from __future__ import annotations

import io
import json
import re
import zipfile
from pathlib import PurePath
from xml.etree import ElementTree as ET

from lb_tool.schemas import ExportAnnotation, ExportFormat, ExportImage, ExportRequest


def build_export_archive(request: ExportRequest) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        if request.format == ExportFormat.YOLO:
            _write_yolo(archive, request)
        elif request.format == ExportFormat.COCO:
            _write_coco(archive, request)
        else:
            _write_voc(archive, request)
        archive.writestr("README.txt", _readme(request.format))
    return buffer.getvalue()


def _write_yolo(archive: zipfile.ZipFile, request: ExportRequest) -> None:
    ordered_classes = sorted(request.classes.items())
    archive.writestr("classes.txt", "\n".join(name for _, name in ordered_classes) + "\n")
    names_yaml = "\n".join(f"  {class_id}: {json.dumps(name, ensure_ascii=False)}" for class_id, name in ordered_classes)
    archive.writestr(
        "data.yaml",
        f"path: .\ntrain: images/train\nval: images/val\nnames:\n{names_yaml}\n",
    )
    for image in request.images:
        lines = [
            _yolo_line(annotation, image, request.include_confidence)
            for annotation in image.annotations
        ]
        archive.writestr(f"labels/{_safe_stem(image.filename)}.txt", "\n".join(lines) + ("\n" if lines else ""))


def _yolo_line(annotation: ExportAnnotation, image: ExportImage, include_confidence: bool) -> str:
    x1 = min(max(annotation.x1, 0.0), float(image.width))
    y1 = min(max(annotation.y1, 0.0), float(image.height))
    x2 = min(max(annotation.x2, 0.0), float(image.width))
    y2 = min(max(annotation.y2, 0.0), float(image.height))
    x_center = ((x1 + x2) / 2.0) / image.width
    y_center = ((y1 + y2) / 2.0) / image.height
    width = (x2 - x1) / image.width
    height = (y2 - y1) / image.height
    values = [
        str(annotation.class_id),
        f"{x_center:.6f}",
        f"{y_center:.6f}",
        f"{width:.6f}",
        f"{height:.6f}",
    ]
    if include_confidence and annotation.score is not None:
        values.append(f"{annotation.score:.6f}")
    return " ".join(values)


def _write_coco(archive: zipfile.ZipFile, request: ExportRequest) -> None:
    images = []
    annotations = []
    annotation_id = 1
    for image_id, image in enumerate(request.images, start=1):
        images.append(
            {"id": image_id, "file_name": image.filename, "width": image.width, "height": image.height}
        )
        for item in image.annotations:
            width = max(0.0, min(item.x2, image.width) - max(item.x1, 0.0))
            height = max(0.0, min(item.y2, image.height) - max(item.y1, 0.0))
            annotation = {
                "id": annotation_id,
                "image_id": image_id,
                "category_id": item.class_id,
                "bbox": [max(item.x1, 0.0), max(item.y1, 0.0), width, height],
                "area": width * height,
                "iscrowd": 0,
            }
            if request.include_confidence and item.score is not None:
                annotation["score"] = item.score
            annotations.append(annotation)
            annotation_id += 1
    payload = {
        "info": {"description": "Label Bench export", "version": "1.0"},
        "images": images,
        "annotations": annotations,
        "categories": [
            {"id": class_id, "name": name, "supercategory": "object"}
            for class_id, name in sorted(request.classes.items())
        ],
    }
    archive.writestr(
        "annotations.json",
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
    )


def _write_voc(archive: zipfile.ZipFile, request: ExportRequest) -> None:
    for image in request.images:
        root = ET.Element("annotation")
        ET.SubElement(root, "folder").text = "images"
        ET.SubElement(root, "filename").text = image.filename
        size = ET.SubElement(root, "size")
        ET.SubElement(size, "width").text = str(image.width)
        ET.SubElement(size, "height").text = str(image.height)
        ET.SubElement(size, "depth").text = "3"
        ET.SubElement(root, "segmented").text = "0"
        for item in image.annotations:
            obj = ET.SubElement(root, "object")
            ET.SubElement(obj, "name").text = request.classes.get(item.class_id, item.label)
            ET.SubElement(obj, "pose").text = "Unspecified"
            ET.SubElement(obj, "truncated").text = "0"
            ET.SubElement(obj, "difficult").text = "0"
            box = ET.SubElement(obj, "bndbox")
            ET.SubElement(box, "xmin").text = str(round(max(item.x1, 0.0)))
            ET.SubElement(box, "ymin").text = str(round(max(item.y1, 0.0)))
            ET.SubElement(box, "xmax").text = str(round(min(item.x2, image.width)))
            ET.SubElement(box, "ymax").text = str(round(min(item.y2, image.height)))
            if request.include_confidence and item.score is not None:
                ET.SubElement(obj, "confidence").text = f"{item.score:.6f}"
        ET.indent(root, space="  ")
        xml = ET.tostring(root, encoding="utf-8", xml_declaration=True)
        archive.writestr(f"annotations/{_safe_stem(image.filename)}.xml", xml)


def _safe_stem(filename: str) -> str:
    stem = PurePath(filename).stem
    safe = re.sub(r"[^\w.-]+", "_", stem, flags=re.UNICODE).strip("._")
    return safe or "image"


def _readme(export_format: ExportFormat) -> str:
    return (
        "Label Bench annotation export\n"
        f"Format: {export_format.value}\n"
        "Coordinates were clipped to each image boundary during export.\n"
        "Original image files are not included.\n"
    )

