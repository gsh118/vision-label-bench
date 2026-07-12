import { afterEach, describe, expect, it, vi } from "vitest";
import { inferImage, loadModel } from "./api";
import type { ModelConfig, SessionImage } from "../types";

const config: ModelConfig = {
  adapter: "yolo",
  modelRef: "yolo11n.pt",
  device: "auto",
  confidence: 0.25,
  iou: 0.7,
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("API cancellation", () => {
  it("forwards an AbortSignal while loading a model", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}));
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();

    await loadModel(config, controller.signal);

    expect(fetchMock).toHaveBeenCalledWith("/api/models/load", expect.objectContaining({
      signal: controller.signal,
    }));
  });

  it("forwards an AbortSignal while running inference", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}));
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();
    const image = {
      file: new File([new Uint8Array([1, 2, 3])], "sample.png", { type: "image/png" }),
      name: "sample.png",
    } as SessionImage;

    await inferImage(image, config, controller.signal);

    expect(fetchMock).toHaveBeenCalledWith("/api/infer", expect.objectContaining({
      method: "POST",
      signal: controller.signal,
    }));
  });
});

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
