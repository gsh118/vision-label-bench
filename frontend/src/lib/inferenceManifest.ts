import type { ModelInspection } from "../types";

export const INFERENCE_MANIFEST_SCHEMA = "vision-label-bench-inference";

export interface InferenceManifest {
  schema: typeof INFERENCE_MANIFEST_SCHEMA;
  version: 1;
  captured_at: string;
  model: ModelInspection["model"];
  image: {
    name: string;
    sha256: string;
    content_type: string | null;
    source_size: [number, number];
    processed_size: [number, number];
    source_color_mode: string;
    processed_color_mode: "RGB";
    exif_orientation: number | null;
    exif_transposed: boolean;
  };
  preprocessing: {
    pipeline: string;
    configured_input_size: string | null;
  };
  parameters: {
    confidence: number;
    iou: number | null;
    nms_applied: boolean;
    requested_device: string;
    resolved_device: string;
  };
  result: {
    elapsed_ms: number;
    detection_count: number;
    class_counts: Record<string, number>;
    score: {
      min: number | null;
      max: number | null;
      mean: number | null;
    };
  };
}

export function createInferenceManifest(inspection: ModelInspection): InferenceManifest | null {
  const inference = inspection.inference;
  if (!inference) return null;
  const trace = inference.trace;
  return {
    schema: INFERENCE_MANIFEST_SCHEMA,
    version: 1,
    captured_at: inference.capturedAt,
    model: { ...inspection.model, classes: { ...inspection.model.classes } },
    image: {
      name: trace.image_name,
      sha256: trace.image_sha256,
      content_type: trace.content_type,
      source_size: [trace.source_width, trace.source_height],
      processed_size: [trace.processed_width, trace.processed_height],
      source_color_mode: trace.source_color_mode,
      processed_color_mode: trace.processed_color_mode,
      exif_orientation: trace.exif_orientation,
      exif_transposed: trace.exif_transposed,
    },
    preprocessing: {
      pipeline: trace.preprocessing,
      configured_input_size: trace.configured_input_size,
    },
    parameters: {
      confidence: trace.confidence,
      iou: trace.iou,
      nms_applied: trace.nms_applied,
      requested_device: trace.requested_device,
      resolved_device: trace.resolved_device,
    },
    result: {
      elapsed_ms: inference.elapsedMs,
      detection_count: trace.detection_count,
      class_counts: { ...trace.class_counts },
      score: {
        min: trace.score_min,
        max: trace.score_max,
        mean: trace.score_mean,
      },
    },
  };
}

export function stringifyInferenceManifest(inspection: ModelInspection): string | null {
  const manifest = createInferenceManifest(inspection);
  return manifest ? JSON.stringify(manifest, null, 2) : null;
}

export function inferenceManifestFilename(inspection: ModelInspection): string {
  const imageName = inspection.inference?.imageName ?? "image";
  const stem = imageName.replace(/\.[^.]+$/, "").replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "image";
  return `${stem}-inference-manifest.json`;
}
