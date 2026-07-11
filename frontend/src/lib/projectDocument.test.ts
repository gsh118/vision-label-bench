import { describe, expect, it } from "vitest";
import type { Annotation, SessionImage } from "../types";
import {
  createProjectDocument,
  hydrateProjectDocument,
  parseProjectDocument,
  ProjectDocumentError,
  type ProjectState,
} from "./projectDocument";

const annotation: Annotation = {
  id: "box-1",
  classId: 3,
  label: "connector",
  score: 0.83,
  source: "model",
  reviewState: "suggested",
  x1: 12,
  y1: 14,
  x2: 88,
  y2: 96,
};

function makeState(status: SessionImage["status"] = "running"): ProjectState {
  const file = new File([new Uint8Array([1, 2, 3])], "frame-01.png", {
    type: "image/png",
    lastModified: 1_762_339_261_000,
  });
  return {
    modelConfig: {
      adapter: "yolo",
      modelRef: "D:\\models\\best.pt",
      device: "cuda",
      confidence: 0.37,
      iou: 0.62,
    },
    classes: [{ id: 3, name: "connector", color: "#99c2a2" }],
    selectedImageId: "image-1",
    preferences: {
      zoom: 1.4,
      exportFormat: "coco",
      exportScope: "current",
      includeConfidence: true,
      includeSuggestions: false,
    },
    images: [{
      id: "image-1",
      file,
      name: file.name,
      url: "blob:runtime-only",
      width: 640,
      height: 480,
      status,
      elapsedMs: 18.7,
      annotations: [annotation],
      error: "runtime-only error",
    }],
  };
}

describe("project document", () => {
  it("extracts a versioned document without transient browser state", () => {
    const document = createProjectDocument(makeState(), "2026-07-11T08:30:00.000Z");

    expect(document.schema).toBe("vision-label-bench");
    expect(document.version).toBe(1);
    expect(document.images[0]).not.toHaveProperty("file");
    expect(document.images[0]).not.toHaveProperty("url");
    expect(document.images[0]).not.toHaveProperty("status");
    expect(document.images[0]).not.toHaveProperty("error");
    expect(document.images[0].annotations).toEqual([annotation]);
  });

  it("validates and hydrates files while recreating object URLs", () => {
    const state = makeState("error");
    const parsed = parseProjectDocument(JSON.parse(JSON.stringify(createProjectDocument(state))));
    const hydrated = hydrateProjectDocument(
      parsed,
      new Map([["image-1", state.images[0].file]]),
      (file) => `blob:restored/${file.name}`,
    );

    expect(hydrated.modelConfig).toEqual(state.modelConfig);
    expect(hydrated.preferences).toEqual(state.preferences);
    expect(hydrated.images[0]).toMatchObject({
      id: "image-1",
      url: "blob:restored/frame-01.png",
      status: "ready",
      error: null,
      annotations: [annotation],
    });
  });

  it("restores an empty image to idle rather than a transient status", () => {
    const state = makeState();
    state.images[0].annotations = [];
    const document = createProjectDocument(state);
    const hydrated = hydrateProjectDocument(document, new Map([["image-1", state.images[0].file]]), () => "blob:empty");

    expect(hydrated.images[0].status).toBe("idle");
  });

  it("rejects unsupported or corrupt project data", () => {
    const document = createProjectDocument(makeState());

    expect(() => parseProjectDocument({ ...document, version: 7 })).toThrow(ProjectDocumentError);
    expect(() => parseProjectDocument({ ...document, images: [{ ...document.images[0], width: -1 }] })).toThrow(
      "images[0].width",
    );
    expect(() => hydrateProjectDocument(document, new Map())).toThrow("이미지 파일을 복구하지 못했습니다");
  });

  it("migrates legacy v1 labels as accepted without changing old export behavior", () => {
    const legacy = JSON.parse(JSON.stringify(createProjectDocument(makeState()))) as Record<string, any>;
    delete legacy.preferences.includeSuggestions;
    delete legacy.images[0].annotations[0].reviewState;

    const parsed = parseProjectDocument(legacy);
    expect(parsed.preferences.includeSuggestions).toBe(false);
    expect(parsed.images[0].annotations[0].reviewState).toBe("accepted");
  });

  it("round-trips every review state and rejects invalid review settings", () => {
    const state = makeState();
    state.images[0].annotations = [
      { ...annotation, id: "suggested", reviewState: "suggested" },
      { ...annotation, id: "accepted", reviewState: "accepted" },
      { ...annotation, id: "edited", reviewState: "edited" },
    ];
    const document = createProjectDocument(state);
    expect(parseProjectDocument(document).images[0].annotations.map((item) => item.reviewState)).toEqual([
      "suggested",
      "accepted",
      "edited",
    ]);

    expect(() => parseProjectDocument({
      ...document,
      preferences: { ...document.preferences, includeSuggestions: "yes" },
    })).toThrow("검수 전 제안 포함 설정");
    expect(() => parseProjectDocument({
      ...document,
      images: [{
        ...document.images[0],
        annotations: [{ ...document.images[0].annotations[0], reviewState: "unknown" }],
      }],
    })).toThrow("reviewState");
  });
});
