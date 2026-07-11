import { describe, expect, it } from "vitest";
import type { ModelInspection } from "../types";
import {
  createInferenceManifest,
  inferenceManifestFilename,
  stringifyInferenceManifest,
} from "./inferenceManifest";

function inspection(): ModelInspection {
  return {
    model: {
      adapter: "yolo",
      model_ref: "D:\\models\\best.pt",
      device: "cuda:0",
      classes: { "0": "connector" },
      model_type: "best",
      architecture: "DetectionModel",
      task: "detect",
      format: "PT",
      runtime_version: "8.4.92",
      input_size: "640 × 640",
      parameter_count: 20_091_328,
      file_size: 80_983_041,
    },
    loadTimeMs: 842,
    cached: false,
    inference: {
      imageName: "라인 샘플 01.jpg",
      detectionCount: 2,
      elapsedMs: 31.7,
      capturedAt: "2026-07-11T12:00:00.000Z",
      trace: {
        image_name: "라인 샘플 01.jpg",
        image_sha256: "a".repeat(64),
        content_type: "image/jpeg",
        source_width: 1920,
        source_height: 1080,
        processed_width: 1920,
        processed_height: 1080,
        source_color_mode: "RGB",
        processed_color_mode: "RGB",
        exif_orientation: null,
        exif_transposed: false,
        preprocessing: "PIL EXIF transpose → RGB → Ultralytics letterbox",
        configured_input_size: "640 × 640",
        confidence: 0.31,
        iou: 0.55,
        nms_applied: true,
        requested_device: "auto",
        resolved_device: "cuda:0",
        detection_count: 2,
        class_counts: { "0": 2 },
        score_min: 0.63,
        score_max: 0.88,
        score_mean: 0.755,
      },
    },
  };
}

describe("inference manifest", () => {
  it("captures the image fingerprint, preprocessing and post-processing settings", () => {
    const manifest = createInferenceManifest(inspection());
    expect(manifest).toMatchObject({
      schema: "vision-label-bench-inference",
      version: 1,
      image: { sha256: "a".repeat(64), source_size: [1920, 1080] },
      parameters: { confidence: 0.31, iou: 0.55, nms_applied: true },
      result: { detection_count: 2, class_counts: { "0": 2 } },
    });
    expect(JSON.parse(stringifyInferenceManifest(inspection())!)).toEqual(manifest);
  });

  it("returns no manifest before inference and creates a safe filename", () => {
    const value = inspection();
    value.inference = null;
    expect(createInferenceManifest(value)).toBeNull();
    expect(inferenceManifestFilename(inspection())).toBe("01-inference-manifest.json");
  });
});
