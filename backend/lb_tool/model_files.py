from __future__ import annotations

import os
import string
from pathlib import Path

from lb_tool.schemas import ModelBrowseEntry, ModelBrowseResponse

MODEL_EXTENSIONS = frozenset(
    {
        ".bin",
        ".ckpt",
        ".engine",
        ".mlpackage",
        ".onnx",
        ".pb",
        ".pdmodel",
        ".pt",
        ".pth",
        ".safetensors",
        ".tflite",
        ".torchscript",
    }
)


def browse_model_files(raw_path: str | None = None) -> ModelBrowseResponse:
    requested = Path(raw_path).expanduser() if raw_path else Path.home()
    current = requested.resolve(strict=True)
    if current.is_file():
        current = current.parent
    if not current.is_dir():
        raise NotADirectoryError(str(current))

    entries: list[ModelBrowseEntry] = []
    for entry in current.iterdir():
        try:
            if entry.is_dir():
                entries.append(
                    ModelBrowseEntry(
                        name=entry.name,
                        path=str(entry.resolve(strict=False)),
                        kind="directory",
                    )
                )
            elif entry.is_file() and entry.suffix.lower() in MODEL_EXTENSIONS:
                entries.append(
                    ModelBrowseEntry(
                        name=entry.name,
                        path=str(entry.resolve(strict=False)),
                        kind="model",
                        size=entry.stat().st_size,
                    )
                )
        except OSError:
            # Keep one inaccessible child from hiding the rest of the directory.
            continue

    entries.sort(key=lambda item: (item.kind != "directory", item.name.casefold()))
    parent = None if current.parent == current else str(current.parent)
    return ModelBrowseResponse(
        current=str(current),
        parent=parent,
        home=str(Path.home().resolve()),
        roots=_filesystem_roots(),
        entries=entries,
    )


def _filesystem_roots() -> list[str]:
    if hasattr(os, "listdrives"):
        drives = [str(Path(drive)) for drive in os.listdrives()]
        if drives:
            return drives
    if os.name == "nt":
        drives = [f"{letter}:\\" for letter in string.ascii_uppercase if Path(f"{letter}:\\").exists()]
        if drives:
            return drives
    return [str(Path("/").resolve())]
