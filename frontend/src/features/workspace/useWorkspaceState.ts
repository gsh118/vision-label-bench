import { useCallback, useEffect, useRef, useState, type MutableRefObject, type SetStateAction } from "react";
import type { Annotation, LabelClass, ModelConfig, SessionImage } from "../../types";

type SyncedSetter<T> = (next: SetStateAction<T>) => void;

export interface WorkspaceController {
  images: SessionImage[];
  imagesRef: MutableRefObject<SessionImage[]>;
  setImages: SyncedSetter<SessionImage[]>;
  replaceSessionImages: (images: SessionImage[]) => void;
  appendSessionImages: (images: SessionImage[]) => void;
  replaceImageAnnotations: (imageId: string, annotations: Annotation[]) => void;
  patchSessionImage: (imageId: string, patch: Partial<Omit<SessionImage, "id">>) => void;
  selectedImageId: string | null;
  selectedImageIdRef: MutableRefObject<string | null>;
  setSelectedImageId: SyncedSetter<string | null>;
  selectedAnnotationId: string | null;
  selectedAnnotationIdRef: MutableRefObject<string | null>;
  setSelectedAnnotationId: SyncedSetter<string | null>;
  classes: LabelClass[];
  classesRef: MutableRefObject<LabelClass[]>;
  setClasses: SyncedSetter<LabelClass[]>;
  modelConfig: ModelConfig;
  modelConfigRef: MutableRefObject<ModelConfig>;
  setModelConfig: SyncedSetter<ModelConfig>;
}

export function useWorkspaceState(
  initialClasses: LabelClass[],
  initialModelConfig: ModelConfig,
): WorkspaceController {
  const [images, setImagesState] = useState<SessionImage[]>([]);
  const [selectedImageId, setSelectedImageIdState] = useState<string | null>(null);
  const [selectedAnnotationId, setSelectedAnnotationIdState] = useState<string | null>(null);
  const [classes, setClassesState] = useState<LabelClass[]>(() => cloneClasses(initialClasses));
  const [modelConfig, setModelConfigState] = useState<ModelConfig>(() => ({ ...initialModelConfig }));

  const imagesRef = useRef(images);
  const selectedImageIdRef = useRef(selectedImageId);
  const selectedAnnotationIdRef = useRef(selectedAnnotationId);
  const classesRef = useRef(classes);
  const modelConfigRef = useRef(modelConfig);

  const setImages = useSyncedSetter(imagesRef, setImagesState);
  const setSelectedImageId = useSyncedSetter(selectedImageIdRef, setSelectedImageIdState);
  const setSelectedAnnotationId = useSyncedSetter(selectedAnnotationIdRef, setSelectedAnnotationIdState);
  const setClasses = useSyncedSetter(classesRef, setClassesState);
  const setModelConfig = useSyncedSetter(modelConfigRef, setModelConfigState);

  const replaceSessionImages = useCallback((nextImages: SessionImage[]) => {
    const previousImages = imagesRef.current;
    setImages(nextImages);
    const retainedUrls = new Set(nextImages.map((image) => image.url));
    for (const image of previousImages) {
      if (!retainedUrls.has(image.url)) URL.revokeObjectURL(image.url);
    }
  }, [setImages]);

  const appendSessionImages = useCallback((newImages: SessionImage[]) => {
    if (!newImages.length) return;
    setImages((current) => [...current, ...newImages]);
  }, [setImages]);

  const replaceImageAnnotations = useCallback((imageId: string, annotations: Annotation[]) => {
    setImages((current) => current.map((image) => image.id === imageId
      ? { ...image, annotations }
      : image));
  }, [setImages]);

  const patchSessionImage = useCallback((imageId: string, patch: Partial<Omit<SessionImage, "id">>) => {
    setImages((current) => current.map((image) => image.id === imageId
      ? { ...image, ...patch }
      : image));
  }, [setImages]);

  useEffect(() => () => {
    for (const image of imagesRef.current) URL.revokeObjectURL(image.url);
  }, []);

  return {
    images,
    imagesRef,
    setImages,
    replaceSessionImages,
    appendSessionImages,
    replaceImageAnnotations,
    patchSessionImage,
    selectedImageId,
    selectedImageIdRef,
    setSelectedImageId,
    selectedAnnotationId,
    selectedAnnotationIdRef,
    setSelectedAnnotationId,
    classes,
    classesRef,
    setClasses,
    modelConfig,
    modelConfigRef,
    setModelConfig,
  };
}

function useSyncedSetter<T>(
  ref: MutableRefObject<T>,
  setState: (next: SetStateAction<T>) => void,
): SyncedSetter<T> {
  return useCallback((next: SetStateAction<T>) => {
    const value = typeof next === "function"
      ? (next as (current: T) => T)(ref.current)
      : next;
    ref.current = value;
    setState(value);
  }, [ref, setState]);
}

function cloneClasses(classes: LabelClass[]): LabelClass[] {
  return classes.map((item) => ({ ...item }));
}
