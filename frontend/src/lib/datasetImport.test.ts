import { zipSync, strToU8 } from "fflate";
import { describe, expect, it } from "vitest";
import {
  createVirtualFiles,
  importClassFile,
  importYoloDataset,
  resolveClassConflicts,
  zipToVirtualFiles,
} from "./datasetImport";

const dimensions = async () => ({ width: 1000, height: 500 });

function file(name: string, content = "", type = "text/plain"): File {
  return new File([content], name, { type });
}

describe("dataset import", () => {
  it("imports YOLO list names, splits, boxes, confidence, and negative images", async () => {
    const files = createVirtualFiles([
      { path: "set/data.yaml", file: file("data.yaml", "path: .\ntrain: images/train\nval: images/val\nnames: [person, helmet]\n") },
      { path: "set/images/train/a.jpg", file: file("a.jpg", "image", "image/jpeg") },
      { path: "set/labels/train/a.txt", file: file("a.txt", "1 0.2 0.4 0.2 0.4 0.75\n") },
      { path: "set/images/val/negative.png", file: file("negative.png", "image", "image/png") },
    ]);
    const result = await importYoloDataset(files, "folder", dimensions);
    expect(result.classes).toEqual([{ id: 0, name: "person" }, { id: 1, name: "helmet" }]);
    expect(result.images.map((image) => image.split)).toEqual(["train", "val"]);
    expect(result.images[0].relativePath).toBe("images/train/a.jpg");
    expect(result.images[0].annotations[0]).toMatchObject({ classId: 1, score: 0.75, x1: 100, y1: 100, source: "import", reviewState: "accepted" });
    expect(result.images[0].annotations[0].x2).toBeCloseTo(300);
    expect(result.images[0].annotations[0].y2).toBeCloseTo(300);
    expect(result.images[1].annotations).toEqual([]);
    expect(result.issues).toEqual([]);
  });

  it("supports names maps and image list files", async () => {
    const files = createVirtualFiles([
      { path: "data.yml", file: file("data.yml", "train: train.txt\nnames:\n  3: helmet\n") },
      { path: "train.txt", file: file("train.txt", "images/frame.webp\n") },
      { path: "images/frame.webp", file: file("frame.webp", "image", "image/webp") },
      { path: "labels/frame.txt", file: file("frame.txt", "3 0.5 0.5 1 1\n") },
    ]);
    const result = await importYoloDataset(files, "files", dimensions);
    expect(result.classes).toEqual([{ id: 3, name: "helmet" }]);
    expect(result.images[0].annotations).toHaveLength(1);
  });

  it("reports unsupported and out-of-bounds label rows as blocking errors", async () => {
    const files = createVirtualFiles([
      { path: "data.yaml", file: file("data.yaml", "train: images/train\nnames: [object]\n") },
      { path: "images/train/a.jpg", file: file("a.jpg", "image", "image/jpeg") },
      { path: "labels/train/a.txt", file: file("a.txt", "0 0.5 0.5 0.2 0.2 0.4 7\n0 0.05 0.05 0.2 0.2\n") },
    ]);
    const result = await importYoloDataset(files, "bad", dimensions);
    expect(result.issues.filter((issue) => issue.level === "error")).toHaveLength(2);
    expect(result.images[0].annotations).toEqual([]);
  });

  it("rejects path traversal and normalized duplicates", () => {
    expect(() => createVirtualFiles([{ path: "../data.yaml", file: file("data.yaml") }])).toThrow("상위 경로");
    expect(() => createVirtualFiles([
      { path: "set/data.yaml", file: file("a") },
      { path: "SET\\data.yaml", file: file("b") },
    ])).toThrow("중복된 파일 경로");
  });

  it("creates the same manifest from a ZIP virtual tree", async () => {
    const bytes = zipSync({
      "data.yaml": strToU8("train: images/train\nnames: [object]\n"),
      "images/train/a.jpg": strToU8("image"),
      "labels/train/a.txt": strToU8("0 0.5 0.5 0.2 0.2\n"),
    });
    const virtual = await zipToVirtualFiles(new File([bytes.slice().buffer], "set.zip", { type: "application/zip" }));
    const result = await importYoloDataset(virtual, "set.zip", dimensions);
    expect(result.images).toHaveLength(1);
    expect(result.images[0].annotations).toHaveLength(1);
  });

  it("imports classes.txt and COCO categories", async () => {
    await expect(importClassFile(file("classes.txt", "person\nhelmet\n"))).resolves.toMatchObject({ classes: [{ id: 0, name: "person" }, { id: 1, name: "helmet" }] });
    await expect(importClassFile(file("coco.json", JSON.stringify({ categories: [{ id: 7, name: "forklift" }] }), "application/json"))).resolves.toMatchObject({ format: "coco-categories", classes: [{ id: 7, name: "forklift" }] });
  });
});

describe("class conflict resolution", () => {
  it("preserves existing names and allocates deterministic free IDs", () => {
    const result = resolveClassConflicts(
      [{ id: 0, name: "person" }, { id: 2, name: "helmet" }],
      [{ id: 7, name: "person" }, { id: 2, name: "vehicle" }, { id: 5, name: "forklift" }],
    );
    expect(result).toEqual([
      expect.objectContaining({ sourceId: 7, targetId: 0, conflict: "same-name" }),
      expect.objectContaining({ sourceId: 2, targetId: 1, conflict: "id-conflict" }),
      expect.objectContaining({ sourceId: 5, targetId: 5, conflict: "new" }),
    ]);
  });

  it("does not cascade one ID collision across the remaining model classes", () => {
    const incoming = Array.from({ length: 4 }, (_, id) => ({ id, name: `model-${id}` }));
    const result = resolveClassConflicts([{ id: 0, name: "project-object" }], incoming);
    expect(result.map((item) => item.targetId)).toEqual([4, 1, 2, 3]);
  });
});
