import { describe, expect, it, vi } from "vitest";
import type { SessionImage } from "../types";
import type { ProjectState } from "./projectDocument";
import {
  createProjectBackup,
  hydrateProjectBackup,
  parseProjectBackup,
} from "./projectBackup";

function makeState(): ProjectState {
  const file = new File([new Uint8Array([11, 27, 43, 59])], "sample.png", {
    type: "image/png",
    lastModified: 1_762_339_261_000,
  });
  const image: SessionImage = {
    id: "sample",
    file,
    name: file.name,
    url: "blob:sample",
    width: 128,
    height: 96,
    status: "ready",
    elapsedMs: null,
    annotations: [],
    error: null,
  };
  return {
    modelConfig: { adapter: "auto", modelRef: "yolo11n.pt", device: "auto", confidence: 0.25, iou: 0.7 },
    classes: [{ id: 0, name: "object", color: "#99c2a2" }],
    images: [image],
    selectedImageId: image.id,
    preferences: { zoom: 1, exportFormat: "yolo", exportScope: "all", includeConfidence: false },
  };
}

describe("portable project backup", () => {
  it("embeds image bytes and restores the original file", async () => {
    const state = makeState();
    const backup = await createProjectBackup(state);
    const parsed = parseProjectBackup(JSON.parse(JSON.stringify(backup)));
    const createObjectUrl = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:restored");
    const restored = hydrateProjectBackup(parsed);

    expect(new Uint8Array(await restored.images[0].file.arrayBuffer())).toEqual(new Uint8Array([11, 27, 43, 59]));
    expect(restored.images[0]).toMatchObject({ name: "sample.png", url: "blob:restored" });
    createObjectUrl.mockRestore();
  });

  it("rejects missing image payloads and unsupported versions", async () => {
    const backup = await createProjectBackup(makeState());
    expect(() => parseProjectBackup({ ...backup, files: [] })).toThrow("백업에 이미지가 없습니다");
    expect(() => parseProjectBackup({ ...backup, version: 4 })).toThrow("지원하지 않는 백업 버전");
  });
});
