import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SessionImage } from "../types";
import type { ProjectState } from "./projectDocument";
import {
  clearLocalProject,
  deleteProjectDatabase,
  loadLocalProject,
  saveLocalProject,
} from "./projectStore";

function makeImage(id: string, byte: number, annotationCount = 1): SessionImage {
  const file = new File([new Uint8Array([byte, byte + 1])], `${id}.png`, {
    type: "image/png",
    lastModified: 1_762_339_261_000 + byte,
  });
  return {
    id,
    file,
    name: file.name,
    url: `blob:${id}`,
    width: 320,
    height: 240,
    status: "running",
    elapsedMs: 23.4,
    annotations: annotationCount ? [{
      id: `box-${id}`,
      classId: 0,
      label: "object",
      score: null,
      source: "manual",
      reviewState: "accepted",
      x1: 10,
      y1: 20,
      x2: 80,
      y2: 90,
    }] : [],
    error: null,
  };
}

function makeState(images = [makeImage("one", 4)]): ProjectState {
  return {
    modelConfig: { adapter: "auto", modelRef: "yolo11n.pt", device: "auto", confidence: 0.25, iou: 0.7 },
    classes: [{ id: 0, name: "object", color: "#99c2a2" }],
    images,
    selectedImageId: images[0]?.id ?? null,
    preferences: { zoom: 1, exportFormat: "yolo", exportScope: "all", includeConfidence: false, includeSuggestions: false },
  };
}

beforeEach(async () => {
  await deleteProjectDatabase();
});

afterEach(async () => {
  await deleteProjectDatabase();
});

describe("local project store", () => {
  it("round-trips files, annotations, classes and settings", async () => {
    const state = makeState([makeImage("one", 4), makeImage("two", 9, 0)]);
    await saveLocalProject(state);
    const restored = await loadLocalProject();

    expect(restored?.images).toHaveLength(2);
    expect(restored?.images[0].annotations).toEqual(state.images[0].annotations);
    expect(restored?.images[0].status).toBe("ready");
    expect(restored?.images[1].status).toBe("idle");
    expect(await restored?.images[0].file.arrayBuffer()).toEqual(await state.images[0].file.arrayBuffer());
    expect(restored?.modelConfig).toEqual(state.modelConfig);
  });

  it("removes deleted image files from the restored project", async () => {
    const first = makeImage("one", 4);
    const second = makeImage("two", 9);
    await saveLocalProject(makeState([first, second]));
    await saveLocalProject(makeState([second]));

    const restored = await loadLocalProject();
    expect(restored?.images.map((image) => image.id)).toEqual(["two"]);
  });

  it("serializes overlapping writes so the last edit wins", async () => {
    const first = makeState();
    const second = makeState();
    second.classes[0].name = "updated";
    second.images[0].annotations[0].label = "updated";

    await Promise.all([saveLocalProject(first), saveLocalProject(second)]);
    const restored = await loadLocalProject();
    expect(restored?.classes[0].name).toBe("updated");
    expect(restored?.images[0].annotations[0].label).toBe("updated");
  });

  it("clears project metadata and image files together", async () => {
    await saveLocalProject(makeState());
    await clearLocalProject();
    expect(await loadLocalProject()).toBeNull();
  });
});
