import { describe, expect, it } from "vitest";
import type { Annotation } from "../types";
import {
  applyAnnotationCommand,
  recordAnnotationCommand,
  redoAnnotationCommand,
  resolveHistoryShortcut,
  undoAnnotationCommand,
  type AnnotationCommand,
  type AnnotationHistory,
} from "./annotationHistory";

const first: Annotation = {
  id: "first",
  classId: 0,
  label: "object",
  score: null,
  source: "manual",
  x1: 10,
  y1: 20,
  x2: 80,
  y2: 90,
};
const second: Annotation = { ...first, id: "second", x1: 120, x2: 190 };

function execute(history: AnnotationHistory, annotations: Annotation[], command: AnnotationCommand) {
  const applied = applyAnnotationCommand(annotations, command, "forward");
  return {
    history: recordAnnotationCommand(history, command),
    annotations: applied.annotations,
  };
}

describe("annotation history", () => {
  it("creates, undoes and redoes with the same id and order", () => {
    const command: AnnotationCommand = {
      kind: "create",
      imageId: "image-a",
      annotation: second,
      index: 1,
      selectionBefore: null,
      selectionAfter: second.id,
    };
    const executed = execute({}, [first], command);
    const undone = undoAnnotationCommand(executed.history, "image-a", executed.annotations)!;
    const redone = redoAnnotationCommand(undone.history, "image-a", undone.annotations)!;

    expect(undone.annotations).toEqual([first]);
    expect(redone.annotations.map((item) => item.id)).toEqual(["first", "second"]);
    expect(redone.selection).toBe("second");
  });

  it("restores a deleted annotation at its original index with metadata", () => {
    const command: AnnotationCommand = {
      kind: "delete",
      imageId: "image-a",
      annotation: first,
      index: 0,
      selectionBefore: first.id,
      selectionAfter: null,
    };
    const executed = execute({}, [first, second], command);
    const undone = undoAnnotationCommand(executed.history, "image-a", executed.annotations)!;

    expect(undone.annotations).toEqual([first, second]);
    expect(undone.selection).toBe(first.id);
  });

  it("treats an entire move or resize gesture as one command", () => {
    const command: AnnotationCommand = {
      kind: "box",
      imageId: "image-a",
      annotationId: first.id,
      gesture: "move",
      before: { x1: 10, y1: 20, x2: 80, y2: 90 },
      after: { x1: 44, y1: 51, x2: 114, y2: 121 },
      selectionBefore: first.id,
      selectionAfter: first.id,
    };
    const executed = execute({}, [first], command);
    const undone = undoAnnotationCommand(executed.history, "image-a", executed.annotations)!;

    expect(executed.history["image-a"].past).toHaveLength(1);
    expect(undone.annotations[0]).toMatchObject({ x1: 10, y1: 20, x2: 80, y2: 90 });
  });

  it("restores class id and label together", () => {
    const command: AnnotationCommand = {
      kind: "class",
      imageId: "image-a",
      annotationId: first.id,
      before: { classId: 0, label: "object" },
      after: { classId: 7, label: "fastener" },
      selectionBefore: first.id,
      selectionAfter: first.id,
    };
    const executed = execute({}, [first], command);
    const undone = undoAnnotationCommand(executed.history, "image-a", executed.annotations)!;

    expect(executed.annotations[0]).toMatchObject({ classId: 7, label: "fastener" });
    expect(undone.annotations[0]).toMatchObject({ classId: 0, label: "object" });
  });

  it("undoes inference replacement as one atomic edit", () => {
    const predicted = [{ ...second, id: "prediction", source: "model" as const, score: 0.61 }];
    const command: AnnotationCommand = {
      kind: "replace-all",
      imageId: "image-a",
      before: [first],
      after: predicted,
      selectionBefore: first.id,
      selectionAfter: null,
    };
    const executed = execute({}, [first], command);
    const undone = undoAnnotationCommand(executed.history, "image-a", executed.annotations)!;

    expect(executed.annotations).toEqual(predicted);
    expect(undone.annotations).toEqual([first]);
  });

  it("clears redo after a new edit and isolates image histories", () => {
    const createA: AnnotationCommand = {
      kind: "create",
      imageId: "image-a",
      annotation: first,
      index: 0,
      selectionBefore: null,
      selectionAfter: first.id,
    };
    const createB: AnnotationCommand = { ...createA, imageId: "image-b", annotation: second, selectionAfter: second.id };
    const history = recordAnnotationCommand(recordAnnotationCommand({}, createA), createB);
    const undone = undoAnnotationCommand(history, "image-a", [first])!;
    const changed = recordAnnotationCommand(undone.history, {
      ...createA,
      annotation: { ...first, id: "replacement" },
      selectionAfter: "replacement",
    });

    expect(changed["image-a"].future).toHaveLength(0);
    expect(changed["image-b"].past).toHaveLength(1);
  });

  it("skips no-op box edits and bounds each image history", () => {
    let history: AnnotationHistory = {};
    const noop: AnnotationCommand = {
      kind: "box",
      imageId: "image-a",
      annotationId: first.id,
      gesture: "resize",
      before: first,
      after: first,
      selectionBefore: first.id,
      selectionAfter: first.id,
    };
    history = recordAnnotationCommand(history, noop);
    expect(history).toEqual({});

    for (let index = 0; index < 108; index += 1) {
      history = recordAnnotationCommand(history, {
        ...noop,
        before: { ...first, x1: index },
        after: { ...first, x1: index + 1 },
      });
    }
    expect(history["image-a"].past).toHaveLength(100);
  });

  it("maps Windows and macOS shortcuts without hijacking text editing", () => {
    const base = {
      key: "z",
      ctrlKey: true,
      metaKey: false,
      shiftKey: false,
      editingText: false,
      isComposing: false,
      repeat: false,
      defaultPrevented: false,
    };
    expect(resolveHistoryShortcut(base)).toBe("undo");
    expect(resolveHistoryShortcut({ ...base, key: "y" })).toBe("redo");
    expect(resolveHistoryShortcut({ ...base, shiftKey: true })).toBe("redo");
    expect(resolveHistoryShortcut({ ...base, ctrlKey: false, metaKey: true })).toBe("undo");
    expect(resolveHistoryShortcut({ ...base, editingText: true })).toBeNull();
    expect(resolveHistoryShortcut({ ...base, isComposing: true })).toBeNull();
    expect(resolveHistoryShortcut({ ...base, repeat: true })).toBeNull();
  });
});
