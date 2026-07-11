import type { Annotation, BoxCoordinates } from "../types";

const DEFAULT_HISTORY_LIMIT = 100;

interface CommandBase {
  imageId: string;
  selectionBefore: string | null;
  selectionAfter: string | null;
}

export interface CreateAnnotationCommand extends CommandBase {
  kind: "create";
  annotation: Annotation;
  index: number;
}

export interface DeleteAnnotationCommand extends CommandBase {
  kind: "delete";
  annotation: Annotation;
  index: number;
}

export interface BoxAnnotationCommand extends CommandBase {
  kind: "box";
  annotationId: string;
  gesture: "move" | "resize";
  before: BoxCoordinates;
  after: BoxCoordinates;
}

export interface ClassAnnotationCommand extends CommandBase {
  kind: "class";
  annotationId: string;
  before: { classId: number; label: string };
  after: { classId: number; label: string };
}

export interface ReplaceAnnotationsCommand extends CommandBase {
  kind: "replace-all";
  before: Annotation[];
  after: Annotation[];
}

export type AnnotationCommand =
  | CreateAnnotationCommand
  | DeleteAnnotationCommand
  | BoxAnnotationCommand
  | ClassAnnotationCommand
  | ReplaceAnnotationsCommand;

export interface ImageAnnotationHistory {
  past: AnnotationCommand[];
  future: AnnotationCommand[];
}

export type AnnotationHistory = Record<string, ImageAnnotationHistory>;

export interface HistoryTransition {
  history: AnnotationHistory;
  annotations: Annotation[];
  selection: string | null;
  command: AnnotationCommand;
}

export interface HistoryShortcutInput {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  editingText: boolean;
  isComposing: boolean;
  repeat: boolean;
  defaultPrevented: boolean;
}

export function resolveHistoryShortcut(input: HistoryShortcutInput): "undo" | "redo" | null {
  if (input.defaultPrevented || input.isComposing || input.repeat || input.editingText) return null;
  if (!input.ctrlKey && !input.metaKey) return null;
  const key = input.key.toLowerCase();
  if (key === "y") return "redo";
  if (key === "z") return input.shiftKey ? "redo" : "undo";
  return null;
}

export function recordAnnotationCommand(
  history: AnnotationHistory,
  command: AnnotationCommand,
  limit = DEFAULT_HISTORY_LIMIT,
): AnnotationHistory {
  if (isNoopCommand(command)) return history;
  const current = history[command.imageId] ?? { past: [], future: [] };
  return {
    ...history,
    [command.imageId]: {
      past: [...current.past, cloneCommand(command)].slice(-limit),
      future: [],
    },
  };
}

export function applyAnnotationCommand(
  annotations: Annotation[],
  command: AnnotationCommand,
  direction: "forward" | "backward",
): { annotations: Annotation[]; selection: string | null } {
  const forward = direction === "forward";
  if (command.kind === "create") {
    return {
      annotations: forward
        ? insertAt(withoutId(annotations, command.annotation.id), command.index, command.annotation)
        : withoutId(annotations, command.annotation.id),
      selection: forward ? command.selectionAfter : command.selectionBefore,
    };
  }
  if (command.kind === "delete") {
    return {
      annotations: forward
        ? withoutId(annotations, command.annotation.id)
        : insertAt(withoutId(annotations, command.annotation.id), command.index, command.annotation),
      selection: forward ? command.selectionAfter : command.selectionBefore,
    };
  }
  if (command.kind === "box") {
    const box = forward ? command.after : command.before;
    return {
      annotations: annotations.map((annotation) => annotation.id === command.annotationId
        ? { ...annotation, ...box }
        : annotation),
      selection: forward ? command.selectionAfter : command.selectionBefore,
    };
  }
  if (command.kind === "class") {
    const value = forward ? command.after : command.before;
    return {
      annotations: annotations.map((annotation) => annotation.id === command.annotationId
        ? { ...annotation, ...value }
        : annotation),
      selection: forward ? command.selectionAfter : command.selectionBefore,
    };
  }
  return {
    annotations: (forward ? command.after : command.before).map((annotation) => ({ ...annotation })),
    selection: forward ? command.selectionAfter : command.selectionBefore,
  };
}

export function undoAnnotationCommand(
  history: AnnotationHistory,
  imageId: string,
  annotations: Annotation[],
): HistoryTransition | null {
  const current = history[imageId];
  const command = current?.past.at(-1);
  if (!current || !command) return null;
  const applied = applyAnnotationCommand(annotations, command, "backward");
  return {
    annotations: applied.annotations,
    selection: applied.selection,
    command,
    history: {
      ...history,
      [imageId]: {
        past: current.past.slice(0, -1),
        future: [...current.future, command],
      },
    },
  };
}

export function redoAnnotationCommand(
  history: AnnotationHistory,
  imageId: string,
  annotations: Annotation[],
): HistoryTransition | null {
  const current = history[imageId];
  const command = current?.future.at(-1);
  if (!current || !command) return null;
  const applied = applyAnnotationCommand(annotations, command, "forward");
  return {
    annotations: applied.annotations,
    selection: applied.selection,
    command,
    history: {
      ...history,
      [imageId]: {
        past: [...current.past, command],
        future: current.future.slice(0, -1),
      },
    },
  };
}

export function isNoopCommand(command: AnnotationCommand): boolean {
  if (command.kind === "box") return boxesEqual(command.before, command.after);
  if (command.kind === "class") {
    return command.before.classId === command.after.classId && command.before.label === command.after.label;
  }
  if (command.kind === "replace-all") return annotationsEqual(command.before, command.after);
  return false;
}

function cloneCommand(command: AnnotationCommand): AnnotationCommand {
  if (command.kind === "create" || command.kind === "delete") {
    return { ...command, annotation: { ...command.annotation } };
  }
  if (command.kind === "box") {
    return { ...command, before: { ...command.before }, after: { ...command.after } };
  }
  if (command.kind === "class") {
    return { ...command, before: { ...command.before }, after: { ...command.after } };
  }
  return {
    ...command,
    before: command.before.map((annotation) => ({ ...annotation })),
    after: command.after.map((annotation) => ({ ...annotation })),
  };
}

function insertAt(annotations: Annotation[], index: number, annotation: Annotation): Annotation[] {
  const next = [...annotations];
  next.splice(Math.min(Math.max(index, 0), next.length), 0, { ...annotation });
  return next;
}

function withoutId(annotations: Annotation[], id: string): Annotation[] {
  return annotations.filter((annotation) => annotation.id !== id);
}

function boxesEqual(left: BoxCoordinates, right: BoxCoordinates): boolean {
  return left.x1 === right.x1 && left.y1 === right.y1 && left.x2 === right.x2 && left.y2 === right.y2;
}

function annotationsEqual(left: Annotation[], right: Annotation[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((annotation, index) => {
    const other = right[index];
    return annotation.id === other.id
      && annotation.classId === other.classId
      && annotation.label === other.label
      && annotation.score === other.score
      && annotation.source === other.source
      && boxesEqual(annotation, other);
  });
}
