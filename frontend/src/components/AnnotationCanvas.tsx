import { ImageSquare, UploadSimple } from "@phosphor-icons/react";
import { useRef, useState } from "react";
import { boxSize, clampBox, normaliseBox } from "../lib/geometry";
import type { Annotation, BoxCoordinates, LabelClass, SessionImage, ToolKind } from "../types";

type DragMode = "move" | "nw" | "ne" | "sw" | "se";

interface DragState {
  annotationId: string;
  mode: DragMode;
  startX: number;
  startY: number;
  original: BoxCoordinates;
}

interface DrawState {
  startX: number;
  startY: number;
  x: number;
  y: number;
}

interface AnnotationCanvasProps {
  image: SessionImage | null;
  classes: LabelClass[];
  selectedId: string | null;
  tool: ToolKind;
  zoom: number;
  onSelect: (id: string | null) => void;
  onUpdate: (id: string, box: BoxCoordinates) => void;
  onCreate: (box: BoxCoordinates) => void;
  onFiles: (files: FileList | File[]) => void;
}

export function AnnotationCanvas(props: AnnotationCanvasProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [drawing, setDrawing] = useState<DrawState | null>(null);
  const image = props.image;

  if (!image) {
    return (
      <main
        className="canvas-empty"
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          if (event.dataTransfer.files.length) props.onFiles(event.dataTransfer.files);
        }}
      >
        <div className="empty-mark"><ImageSquare size={31} weight="thin" /></div>
        <p>라벨링할 이미지를 놓으세요</p>
        <span>왼쪽 패널에서 파일을 선택하거나 이 영역에 여러 장을 드래그하세요.</span>
        <label className="primary-button mt-5 cursor-pointer">
          <UploadSimple size={16} /> 이미지 선택
          <input
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(event) => event.target.files && props.onFiles(event.target.files)}
          />
        </label>
      </main>
    );
  }

  const classById = new Map(props.classes.map((item) => [item.id, item]));
  const handleSize = Math.max(5, Math.max(image.width, image.height) / 160);
  const fontSize = Math.max(12, Math.max(image.width, image.height) / 70);

  const pointFromEvent = (event: React.PointerEvent<SVGSVGElement | SVGElement>) => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const point = svg.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    const matrix = svg.getScreenCTM()?.inverse();
    const result = matrix ? point.matrixTransform(matrix) : point;
    return { x: result.x, y: result.y };
  };

  const beginDrag = (event: React.PointerEvent<SVGElement>, annotation: Annotation, mode: DragMode) => {
    if (props.tool !== "select") return;
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = pointFromEvent(event);
    props.onSelect(annotation.id);
    setDrag({
      annotationId: annotation.id,
      mode,
      startX: point.x,
      startY: point.y,
      original: annotation,
    });
  };

  const handlePointerMove = (event: React.PointerEvent<SVGSVGElement>) => {
    const point = pointFromEvent(event);
    if (drag) {
      const dx = point.x - drag.startX;
      const dy = point.y - drag.startY;
      let next: BoxCoordinates = { ...drag.original };
      if (drag.mode === "move") {
        const width = drag.original.x2 - drag.original.x1;
        const height = drag.original.y2 - drag.original.y1;
        const x1 = Math.min(Math.max(drag.original.x1 + dx, 0), image.width - width);
        const y1 = Math.min(Math.max(drag.original.y1 + dy, 0), image.height - height);
        next = { x1, y1, x2: x1 + width, y2: y1 + height };
      } else {
        if (drag.mode.includes("n")) next.y1 += dy;
        if (drag.mode.includes("s")) next.y2 += dy;
        if (drag.mode.includes("w")) next.x1 += dx;
        if (drag.mode.includes("e")) next.x2 += dx;
        next = clampBox(next, image.width, image.height);
      }
      const size = boxSize(next);
      if (size.width >= 3 && size.height >= 3) props.onUpdate(drag.annotationId, next);
    } else if (drawing) {
      setDrawing({ ...drawing, x: point.x, y: point.y });
    }
  };

  const handlePointerDown = (event: React.PointerEvent<SVGSVGElement>) => {
    if (event.target !== event.currentTarget && (event.target as Element).tagName !== "image") return;
    props.onSelect(null);
    if (props.tool !== "draw") return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = pointFromEvent(event);
    setDrawing({ startX: point.x, startY: point.y, x: point.x, y: point.y });
  };

  const finishPointer = () => {
    if (drawing) {
      const box = clampBox(
        normaliseBox({ x1: drawing.startX, y1: drawing.startY, x2: drawing.x, y2: drawing.y }),
        image.width,
        image.height,
      );
      const size = boxSize(box);
      if (size.width >= 4 && size.height >= 4) props.onCreate(box);
    }
    setDrag(null);
    setDrawing(null);
  };

  const preview = drawing
    ? normaliseBox({ x1: drawing.startX, y1: drawing.startY, x2: drawing.x, y2: drawing.y })
    : null;

  return (
    <main
      className="canvas-shell scrollbar-thin"
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        if (event.dataTransfer.files.length) props.onFiles(event.dataTransfer.files);
      }}
    >
      <div className="canvas-stage" style={{ width: `${props.zoom * 100}%` }}>
        <svg
          ref={svgRef}
          viewBox={`0 0 ${image.width} ${image.height}`}
          className={`block h-auto w-full select-none ${props.tool === "draw" ? "cursor-crosshair" : "cursor-default"}`}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={finishPointer}
          onPointerCancel={finishPointer}
          aria-label={`${image.name} 라벨 편집 캔버스`}
        >
          <image href={image.url} width={image.width} height={image.height} />
          {image.annotations.map((annotation) => {
            const selected = annotation.id === props.selectedId;
            const labelClass = classById.get(annotation.classId);
            const color = labelClass?.color ?? "#99c2a2";
            const label = `${labelClass?.name ?? annotation.label}${annotation.score == null ? "" : ` ${Math.round(annotation.score * 100)}%`}`;
            const labelWidth = Math.max(fontSize * 3, label.length * fontSize * 0.57 + fontSize);
            const labelY = Math.max(0, annotation.y1 - fontSize * 1.55);
            return (
              <g key={annotation.id}>
                <rect
                  x={annotation.x1}
                  y={annotation.y1}
                  width={annotation.x2 - annotation.x1}
                  height={annotation.y2 - annotation.y1}
                  fill={selected ? `${color}24` : `${color}12`}
                  stroke={color}
                  strokeWidth={selected ? 3 : 2}
                  vectorEffect="non-scaling-stroke"
                  strokeDasharray={selected ? `${handleSize * 1.4} ${handleSize}` : undefined}
                  onPointerDown={(event) => beginDrag(event, annotation, "move")}
                />
                <rect x={annotation.x1} y={labelY} width={labelWidth} height={fontSize * 1.55} rx={fontSize * 0.22} fill={color} />
                <text
                  x={annotation.x1 + fontSize * 0.45}
                  y={labelY + fontSize * 1.08}
                  fill="#101411"
                  fontFamily="Geist Mono, monospace"
                  fontSize={fontSize * 0.78}
                  fontWeight={650}
                  className="pointer-events-none"
                >
                  {label}
                </text>
                {selected && ([
                  ["nw", annotation.x1, annotation.y1],
                  ["ne", annotation.x2, annotation.y1],
                  ["sw", annotation.x1, annotation.y2],
                  ["se", annotation.x2, annotation.y2],
                ] as const).map(([mode, x, y]) => (
                  <rect
                    key={mode}
                    x={x - handleSize}
                    y={y - handleSize}
                    width={handleSize * 2}
                    height={handleSize * 2}
                    rx={handleSize * 0.28}
                    fill="#f1f4ef"
                    stroke={color}
                    strokeWidth={2}
                    vectorEffect="non-scaling-stroke"
                    className={`resize-handle resize-${mode}`}
                    onPointerDown={(event) => beginDrag(event, annotation, mode)}
                  />
                ))}
              </g>
            );
          })}
          {preview && (
            <rect
              x={preview.x1}
              y={preview.y1}
              width={preview.x2 - preview.x1}
              height={preview.y2 - preview.y1}
              fill="#99c2a21c"
              stroke="#b8d9bf"
              strokeWidth={2}
              vectorEffect="non-scaling-stroke"
              strokeDasharray="7 5"
            />
          )}
        </svg>
        {image.status === "running" && (
          <div className="absolute inset-x-0 top-0 h-1 overflow-hidden bg-[#222822]">
            <span className="inference-line block h-full w-1/3 bg-[#99c2a2]" />
          </div>
        )}
      </div>
    </main>
  );
}

