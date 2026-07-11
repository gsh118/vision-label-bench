import { describe, expect, it } from "vitest";
import type { Annotation } from "../types";
import {
  acceptAllSuggestions,
  exportableAnnotations,
  mergeModelSuggestions,
  pendingSuggestionCount,
  prepareImagesForExport,
} from "./review";

function annotation(id: string, reviewState: Annotation["reviewState"], x1 = 10): Annotation {
  return {
    id,
    classId: 2,
    label: "connector",
    score: reviewState === "suggested" ? 0.74 : null,
    source: reviewState === "suggested" ? "model" : "manual",
    reviewState,
    x1,
    y1: 10,
    x2: x1 + 80,
    y2: 90,
  };
}

describe("suggestion review", () => {
  it("accepts only pending model suggestions", () => {
    const values = [annotation("pending", "suggested"), annotation("edited", "edited", 120)];
    const accepted = acceptAllSuggestions(values);

    expect(pendingSuggestionCount(values)).toBe(1);
    expect(accepted.map((item) => item.reviewState)).toEqual(["accepted", "edited"]);
  });

  it("excludes pending suggestions from export unless explicitly enabled", () => {
    const values = [annotation("pending", "suggested"), annotation("accepted", "accepted", 120)];
    expect(exportableAnnotations(values, false).map((item) => item.id)).toEqual(["accepted"]);
    expect(exportableAnnotations(values, true)).toHaveLength(2);
  });

  it("keeps negative images in export without mutating the session", () => {
    const pending = annotation("pending", "suggested");
    const file = new File([new Uint8Array([1])], "negative.png", { type: "image/png" });
    const images = [{
      id: "negative",
      file,
      name: file.name,
      url: "blob:negative",
      width: 64,
      height: 64,
      status: "ready" as const,
      elapsedMs: null,
      annotations: [pending],
      error: null,
      relativePath: null,
      split: "unspecified" as const,
    }];
    const prepared = prepareImagesForExport(images, false);

    expect(prepared).toHaveLength(1);
    expect(prepared[0].annotations).toEqual([]);
    expect(images[0].annotations).toEqual([pending]);
  });

  it("replaces old suggestions while preserving reviewed labels", () => {
    const existing = [
      annotation("manual", "accepted"),
      annotation("old-suggestion", "suggested", 180),
    ];
    const incoming = [
      annotation("duplicate", "suggested", 11),
      annotation("new-suggestion", "suggested", 280),
    ];
    const merged = mergeModelSuggestions(existing, incoming);

    expect(merged.map((item) => item.id)).toEqual(["manual", "new-suggestion"]);
    expect(existing.map((item) => item.id)).toEqual(["manual", "old-suggestion"]);
  });

  it("removes only old suggestions when a rerun has zero detections", () => {
    const existing = [
      annotation("accepted", "accepted"),
      annotation("edited", "edited", 120),
      annotation("old-suggestion", "suggested", 220),
    ];
    expect(mergeModelSuggestions(existing, []).map((item) => item.id)).toEqual(["accepted", "edited"]);
  });
});
