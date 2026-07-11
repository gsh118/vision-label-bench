import type { BoxCoordinates } from "../types";

export function normaliseBox(box: BoxCoordinates): BoxCoordinates {
  return {
    x1: Math.min(box.x1, box.x2),
    y1: Math.min(box.y1, box.y2),
    x2: Math.max(box.x1, box.x2),
    y2: Math.max(box.y1, box.y2),
  };
}

export function clampBox(box: BoxCoordinates, width: number, height: number): BoxCoordinates {
  const normalised = normaliseBox(box);
  return {
    x1: clamp(normalised.x1, 0, width),
    y1: clamp(normalised.y1, 0, height),
    x2: clamp(normalised.x2, 0, width),
    y2: clamp(normalised.y2, 0, height),
  };
}

export function boxSize(box: BoxCoordinates): { width: number; height: number } {
  return { width: box.x2 - box.x1, height: box.y2 - box.y1 };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

