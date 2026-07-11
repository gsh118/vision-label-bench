from __future__ import annotations

import io
import base64
import binascii
import json
import re
import zipfile
from pathlib import PurePath, PurePosixPath
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
    exported_splits = {"train" if image.split == "unspecified" else image.split for image in request.images}
    split_yaml = "\n".join(f"{split_name}: images/{split_name}" for split_name in ("train", "val", "test") if split_name in exported_splits)
    archive.writestr("data.yaml", f"path: .\n{split_yaml}\nnames:\n{names_yaml}\n")
    used_paths_by_split: dict[str, set[str]] = {}
    for image in request.images:
        split = "train" if image.split == "unspecified" else image.split
        relative = _relative_image_path(image)
        output_path = _unique_path(relative, used_paths_by_split.setdefault(split, set()))
        lines = [
            _yolo_line(annotation, image, request.include_confidence)
            for annotation in image.annotations
        ]
        label_path = str(PurePosixPath(output_path).with_suffix(".txt"))
        archive.writestr(f"labels/{split}/{label_path}", "\n".join(lines) + ("\n" if lines else ""))
        if request.include_original_images:
            archive.writestr(f"images/{split}/{output_path}", _decode_image_data(image.image_data or ""))


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


def _relative_image_path(image: ExportImage) -> str:
    raw = (image.relative_path or image.filename).replace("\\", "/")
    parts = list(PurePosixPath(raw).parts)
    if any(part in {"", ".", ".."} for part in parts) or PurePosixPath(raw).is_absolute():
        return _safe_filename(image.filename)
    if "images" in parts:
        index = len(parts) - 1 - parts[::-1].index("images")
        parts = parts[index + 1 :]
        if parts and parts[0] in {"train", "val", "test", "unspecified"}:
            parts = parts[1:]
    safe_parts = [_safe_filename(part) for part in parts]
    return "/".join(safe_parts) if safe_parts else _safe_filename(image.filename)


def _safe_filename(filename: str) -> str:
    safe = re.sub(r"[^\w.-]+", "_", filename, flags=re.UNICODE).strip(".")
    return safe or "image"


def _unique_path(path: str, used: set[str]) -> str:
    candidate = path
    index = 2
    while candidate.casefold() in used:
        pure = PurePosixPath(path)
        candidate = str(pure.with_name(f"{pure.stem}_{index}{pure.suffix}"))
        index += 1
    used.add(candidate.casefold())
    return candidate


def _decode_image_data(value: str) -> bytes:
    if not value.startswith("data:image/") or ";base64," not in value:
        raise ValueError("Invalid original image data")
    try:
        return base64.b64decode(value.split(",", 1)[1], validate=True)
    except (binascii.Error, ValueError) as error:
        raise ValueError("Invalid original image data") from error


def _readme(export_format: ExportFormat) -> str:
    return (
        "Label Bench annotation export\n"
        f"Format: {export_format.value}\n"
        "Coordinates were clipped to each image boundary during export.\n"
        "Original image inclusion follows the export option.\n"
    )
