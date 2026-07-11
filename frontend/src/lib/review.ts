import type { Annotation, SessionImage } from "../types";

export function pendingSuggestionCount(annotations: Annotation[]): number {
  return annotations.filter((annotation) => annotation.reviewState === "suggested").length;
}

export function acceptAllSuggestions(annotations: Annotation[]): Annotation[] {
  return annotations.map((annotation) => annotation.reviewState === "suggested"
    ? { ...annotation, reviewState: "accepted" }
    : annotation);
}

export function exportableAnnotations(annotations: Annotation[], includeSuggestions: boolean): Annotation[] {
  return includeSuggestions
    ? annotations
    : annotations.filter((annotation) => annotation.reviewState !== "suggested");
}

export function prepareImagesForExport(images: SessionImage[], includeSuggestions: boolean): SessionImage[] {
  return images.map((image) => ({
    ...image,
    annotations: exportableAnnotations(image.annotations, includeSuggestions),
  }));
}

export function mergeModelSuggestions(
  existing: Annotation[],
  incoming: Annotation[],
  duplicateIou = 0.85,
): Annotation[] {
  const reviewed = existing.filter((annotation) => annotation.reviewState !== "suggested");
  const suggestions = incoming.filter((candidate) => !reviewed.some((annotation) => (
    annotation.classId === candidate.classId && intersectionOverUnion(annotation, candidate) >= duplicateIou
  )));
  return [...reviewed, ...suggestions];
}

export function intersectionOverUnion(left: Annotation, right: Annotation): number {
  const intersectionWidth = Math.max(0, Math.min(left.x2, right.x2) - Math.max(left.x1, right.x1));
  const intersectionHeight = Math.max(0, Math.min(left.y2, right.y2) - Math.max(left.y1, right.y1));
  const intersection = intersectionWidth * intersectionHeight;
  const leftArea = Math.max(0, left.x2 - left.x1) * Math.max(0, left.y2 - left.y1);
  const rightArea = Math.max(0, right.x2 - right.x1) * Math.max(0, right.y2 - right.y1);
  const union = leftArea + rightArea - intersection;
  return union > 0 ? intersection / union : 0;
}
