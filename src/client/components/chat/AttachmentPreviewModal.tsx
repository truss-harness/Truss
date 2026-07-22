import { useEffect, useRef, useState } from "react";
import type { CSSProperties, PointerEvent } from "react";
import Cropper from "react-easy-crop";
import type { Area, Point } from "react-easy-crop";
import type { ChatAttachment } from "../../../shared/protocol.ts";
import { Modal } from "../Modal.tsx";
import { MaterialIcon } from "../MaterialIcon.tsx";

type AttachmentPreviewMode = "crop" | "preview" | "redact";
type CropAspectPreset = "original" | "square" | "wide" | "portrait";

interface RedactionRect {
  height: number;
  id: string;
  width: number;
  x: number;
  y: number;
}

interface NaturalImageSize {
  height: number;
  width: number;
}

const cropAspectPresets: Array<{ label: string; value: CropAspectPreset }> = [
  { label: "Original", value: "original" },
  { label: "Square", value: "square" },
  { label: "Wide", value: "wide" },
  { label: "Portrait", value: "portrait" },
];

export function AttachmentPreviewModal({
  attachment,
  onClose,
  onCopySuccess,
  onSaveAttachment,
}: {
  attachment: ChatAttachment | null;
  onClose(): void;
  onCopySuccess?(message: string): void;
  onSaveAttachment?(attachment: ChatAttachment): Promise<void> | void;
}) {
  const redactionOverlayRef = useRef<HTMLDivElement | null>(null);
  const [workingAttachment, setWorkingAttachment] = useState<ChatAttachment | null>(attachment);
  const [mode, setMode] = useState<AttachmentPreviewMode>("preview");
  const [textContent, setTextContent] = useState<string | null>(null);
  const [textError, setTextError] = useState<string | null>(null);
  const [crop, setCrop] = useState<Point>({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [naturalAspect, setNaturalAspect] = useState(1);
  const [naturalImageSize, setNaturalImageSize] = useState<NaturalImageSize | null>(null);
  const [aspectPreset, setAspectPreset] = useState<CropAspectPreset>("original");
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null);
  const [redactions, setRedactions] = useState<RedactionRect[]>([]);
  const [redactionStart, setRedactionStart] = useState<Point | null>(null);
  const [draftRedaction, setDraftRedaction] = useState<RedactionRect | null>(null);
  const [actionPending, setActionPending] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    setWorkingAttachment(attachment);
    setMode("preview");
    setTextContent(null);
    setTextError(null);
    setCrop({ x: 0, y: 0 });
    setZoom(1);
    setNaturalAspect(1);
    setNaturalImageSize(null);
    setAspectPreset("original");
    setCroppedAreaPixels(null);
    setRedactions([]);
    setRedactionStart(null);
    setDraftRedaction(null);
    setActionPending(false);
    setActionError(null);
  }, [attachment?.dataUrl, attachment?.id]);

  const activeAttachment = workingAttachment;
  const isImage = activeAttachment?.kind === "image";
  const isText = Boolean(
    activeAttachment && (activeAttachment.kind === "text" || activeAttachment.text),
  );
  const cropAspect = aspectForPreset(aspectPreset, naturalAspect);
  const allRedactions = draftRedaction ? [...redactions, draftRedaction] : redactions;

  useEffect(() => {
    if (!activeAttachment || !isText) {
      return;
    }

    let cancelled = false;

    void (async () => {
      try {
        const content = activeAttachment.text ?? (await textFromDataUrl(activeAttachment.dataUrl));

        if (!cancelled) {
          setTextContent(content);
          setTextError(null);
        }
      } catch {
        if (!cancelled) {
          setTextContent(null);
          setTextError("This attachment could not be displayed as text.");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [activeAttachment, isText]);

  if (!activeAttachment) {
    return null;
  }

  async function saveImageDataUrl(dataUrl: string, successMessage: string): Promise<void> {
    if (!activeAttachment) {
      return;
    }

    setActionPending(true);
    setActionError(null);

    try {
      const updatedAttachment = await imageAttachmentFromDataUrl(activeAttachment, dataUrl);

      await onSaveAttachment?.(updatedAttachment);
      setWorkingAttachment(updatedAttachment);
      onCopySuccess?.(successMessage);
      setMode("preview");
      setRedactions([]);
      setDraftRedaction(null);
      setRedactionStart(null);
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setActionPending(false);
    }
  }

  async function saveCroppedImage(): Promise<void> {
    if (!activeAttachment || !croppedAreaPixels) {
      return;
    }

    const croppedDataUrl = await croppedImageDataUrl(
      activeAttachment.dataUrl,
      croppedAreaPixels,
      outputImageMimeType(activeAttachment),
    );

    await saveImageDataUrl(croppedDataUrl, "Image crop saved.");
  }

  async function saveRedactedImage(): Promise<void> {
    if (!activeAttachment || redactions.length === 0) {
      return;
    }

    const redactedDataUrl = await redactedImageDataUrl(
      activeAttachment.dataUrl,
      redactions,
      outputImageMimeType(activeAttachment),
    );

    await saveImageDataUrl(redactedDataUrl, "Image redaction saved.");
  }

  function startRedaction(event: PointerEvent<HTMLDivElement>): void {
    if (!naturalImageSize || actionPending) {
      return;
    }

    event.preventDefault();
    const point = naturalPointFromPointer(event, naturalImageSize);

    if (!point) {
      return;
    }

    event.currentTarget.setPointerCapture(event.pointerId);
    setRedactionStart(point);
    setDraftRedaction({
      height: 0,
      id: createRedactionId(),
      width: 0,
      x: point.x,
      y: point.y,
    });
  }

  function updateDraftRedaction(event: PointerEvent<HTMLDivElement>): void {
    if (!naturalImageSize || !redactionStart || actionPending) {
      return;
    }

    const point = naturalPointFromPointer(event, naturalImageSize);

    if (!point) {
      return;
    }

    setDraftRedaction(rectFromPoints(redactionStart, point));
  }

  function finishRedaction(event: PointerEvent<HTMLDivElement>): void {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    if (draftRedaction && draftRedaction.width >= 4 && draftRedaction.height >= 4) {
      setRedactions((current) => [...current, draftRedaction]);
    }

    setDraftRedaction(null);
    setRedactionStart(null);
  }

  function resetImageEditState(nextMode: AttachmentPreviewMode): void {
    setMode(nextMode);
    setActionError(null);
    setRedactions([]);
    setDraftRedaction(null);
    setRedactionStart(null);
  }

  const footer = isImage ? (
    mode === "crop" ? (
      <div className="flex w-full flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-1">
          {cropAspectPresets.map((preset) => (
            <button
              aria-pressed={aspectPreset === preset.value}
              className={[
                "h-9 rounded-sm border px-3 text-xs font-semibold transition",
                aspectPreset === preset.value
                  ? "border-primary bg-primary text-on-primary"
                  : "border-outline-variant bg-surface text-on-surface-variant hover:border-outline hover:bg-surface-container-low",
              ].join(" ")}
              disabled={actionPending}
              key={preset.value}
              onClick={() => setAspectPreset(preset.value)}
              type="button"
            >
              {preset.label}
            </button>
          ))}
        </div>
        <div className="flex justify-end gap-2">
          <button
            className="h-10 rounded-sm border border-outline-variant px-4 text-sm font-semibold text-on-surface-variant transition hover:bg-surface-container disabled:cursor-not-allowed disabled:opacity-45"
            disabled={actionPending}
            onClick={() => resetImageEditState("preview")}
            type="button"
          >
            Cancel
          </button>
          <button
            className="inline-flex h-10 items-center gap-2 rounded-sm border border-primary bg-primary px-4 text-sm font-semibold text-on-primary transition hover:bg-primary-container disabled:cursor-not-allowed disabled:opacity-45"
            disabled={actionPending || !croppedAreaPixels}
            onClick={() => void saveCroppedImage()}
            type="button"
          >
            <MaterialIcon name="save" size={18} />
            Save crop
          </button>
        </div>
      </div>
    ) : mode === "redact" ? (
      <div className="flex w-full flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs font-medium text-on-surface-variant">
          Drag over the image to place black redaction boxes.
        </p>
        <div className="flex justify-end gap-2">
          <button
            className="h-10 rounded-sm border border-outline-variant px-4 text-sm font-semibold text-on-surface-variant transition hover:bg-surface-container disabled:cursor-not-allowed disabled:opacity-45"
            disabled={actionPending || redactions.length === 0}
            onClick={() => setRedactions([])}
            type="button"
          >
            Clear
          </button>
          <button
            className="h-10 rounded-sm border border-outline-variant px-4 text-sm font-semibold text-on-surface-variant transition hover:bg-surface-container disabled:cursor-not-allowed disabled:opacity-45"
            disabled={actionPending}
            onClick={() => resetImageEditState("preview")}
            type="button"
          >
            Cancel
          </button>
          <button
            className="inline-flex h-10 items-center gap-2 rounded-sm border border-primary bg-primary px-4 text-sm font-semibold text-on-primary transition hover:bg-primary-container disabled:cursor-not-allowed disabled:opacity-45"
            disabled={actionPending || redactions.length === 0}
            onClick={() => void saveRedactedImage()}
            type="button"
          >
            <MaterialIcon name="save" size={18} />
            Save redactions
          </button>
        </div>
      </div>
    ) : (
      <div className="flex w-full flex-wrap justify-end gap-2">
        <a
          className="inline-flex h-10 items-center gap-2 rounded-sm border border-outline-variant bg-surface px-4 text-sm font-semibold text-on-surface-variant no-underline transition hover:border-outline hover:bg-surface-container-low hover:text-primary"
          download={activeAttachment.name}
          href={activeAttachment.dataUrl}
        >
          <MaterialIcon name="download" size={18} />
          Download
        </a>
        <button
          className="inline-flex h-10 items-center gap-2 rounded-sm border border-outline-variant bg-surface px-4 text-sm font-semibold text-on-surface transition hover:border-outline hover:bg-surface-container-low"
          onClick={() => resetImageEditState("redact")}
          type="button"
        >
          <MaterialIcon name="ink_eraser" size={18} />
          Redact
        </button>
        <button
          className="inline-flex h-10 items-center gap-2 rounded-sm border border-primary bg-primary px-4 text-sm font-semibold text-on-primary transition hover:bg-primary-container"
          onClick={() => resetImageEditState("crop")}
          type="button"
        >
          <MaterialIcon name="crop" size={18} />
          Crop
        </button>
      </div>
    )
  ) : (
    <a
      className="inline-flex h-10 items-center gap-2 rounded-sm border border-outline-variant bg-surface px-4 text-sm font-semibold text-on-surface-variant no-underline transition hover:border-outline hover:bg-surface-container-low hover:text-primary"
      download={activeAttachment.name}
      href={activeAttachment.dataUrl}
    >
      <MaterialIcon name="download" size={18} />
      Download
    </a>
  );

  return (
    <Modal
      bodyClassName="p-0"
      className="truss-attachment-preview-modal"
      closeLabel="Close attachment preview"
      description={`${activeAttachment.mimeType || "File"} / ${formatFileSize(
        activeAttachment.size,
      )}`}
      footer={footer}
      icon={isImage ? "image" : "article"}
      onClose={onClose}
      open
      size="xl"
      title={activeAttachment.name}
    >
      {isImage ? (
        mode === "crop" ? (
          <div className="grid gap-0">
            <div className="relative h-[min(68vh,44rem)] min-h-80 overflow-hidden bg-inverse-surface">
              <Cropper
                aspect={cropAspect}
                classes={{ cropAreaClassName: "truss-image-crop-area" }}
                crop={crop}
                image={activeAttachment.dataUrl}
                maxZoom={6}
                minZoom={1}
                objectFit="contain"
                onCropChange={setCrop}
                onCropComplete={(_, nextCroppedAreaPixels) =>
                  setCroppedAreaPixels(nextCroppedAreaPixels)
                }
                onMediaLoaded={(mediaSize) => {
                  if (mediaSize.naturalHeight > 0) {
                    setNaturalAspect(mediaSize.naturalWidth / mediaSize.naturalHeight);
                    setNaturalImageSize({
                      height: mediaSize.naturalHeight,
                      width: mediaSize.naturalWidth,
                    });
                  }
                }}
                onZoomChange={setZoom}
                showGrid={false}
                zoom={zoom}
              />
            </div>
            <div className="border-t border-outline-variant bg-surface-container-lowest px-4 py-3">
              <label className="flex items-center gap-3 text-xs font-semibold text-on-surface-variant">
                <MaterialIcon name="zoom_in" size={18} />
                <input
                  aria-label="Crop zoom"
                  className="min-w-0 flex-1 accent-primary"
                  disabled={actionPending}
                  max={6}
                  min={1}
                  onChange={(event) => setZoom(Number(event.target.value))}
                  step={0.05}
                  type="range"
                  value={zoom}
                />
                <span className="w-10 text-right">{zoom.toFixed(1)}x</span>
              </label>
              {actionError ? <ImageEditError message={actionError} /> : null}
            </div>
          </div>
        ) : mode === "redact" ? (
          <div className="grid h-[min(72vh,46rem)] place-items-center overflow-auto bg-surface-container-lowest p-4">
            <div className="relative inline-block max-h-full max-w-full align-middle">
              <img
                alt={activeAttachment.name}
                className="block max-h-[min(68vh,43rem)] max-w-full object-contain"
                onLoad={(event) => {
                  const image = event.currentTarget;

                  if (image.naturalHeight > 0) {
                    setNaturalImageSize({
                      height: image.naturalHeight,
                      width: image.naturalWidth,
                    });
                    setNaturalAspect(image.naturalWidth / image.naturalHeight);
                  }
                }}
                src={activeAttachment.dataUrl}
              />
              <div
                aria-label="Redaction drawing area"
                className="absolute inset-0 cursor-crosshair touch-none"
                onPointerCancel={finishRedaction}
                onPointerDown={startRedaction}
                onPointerMove={updateDraftRedaction}
                onPointerUp={finishRedaction}
                ref={redactionOverlayRef}
                role="presentation"
              >
                {allRedactions.map((redaction) => (
                  <span
                    className="absolute block bg-black/95 outline outline-1 outline-white/70"
                    key={redaction.id}
                    style={redactionStyle(redaction, naturalImageSize)}
                  />
                ))}
              </div>
            </div>
            {actionError ? <ImageEditError message={actionError} /> : null}
          </div>
        ) : (
          <div className="grid h-[min(72vh,46rem)] place-items-center overflow-auto bg-surface-container-lowest p-4">
            <img
              alt={activeAttachment.name}
              className="max-h-full max-w-full object-contain"
              onLoad={(event) => {
                const image = event.currentTarget;

                if (image.naturalHeight > 0) {
                  setNaturalImageSize({
                    height: image.naturalHeight,
                    width: image.naturalWidth,
                  });
                  setNaturalAspect(image.naturalWidth / image.naturalHeight);
                }
              }}
              src={activeAttachment.dataUrl}
            />
          </div>
        )
      ) : (
        <div className="truss-message-scrollbar max-h-[72vh] overflow-auto bg-surface-container-lowest p-5">
          {isText ? (
            textError ? (
              <ImageEditError message={textError} />
            ) : textContent === null ? (
              <div className="flex min-h-40 items-center justify-center gap-3 text-sm text-on-surface-variant">
                <span className="truss-spinner h-4 w-4 rounded-full border-2 border-outline-variant border-t-primary" />
                Loading attachment text...
              </div>
            ) : (
              <pre className="whitespace-pre-wrap break-words rounded-sm border border-outline-variant bg-surface px-4 py-3 font-mono text-xs leading-5 text-on-surface">
                {textContent}
              </pre>
            )
          ) : (
            <div className="grid min-h-56 place-items-center rounded-sm border border-outline-variant bg-surface px-4 py-8 text-center text-sm text-on-surface-variant">
              <span>
                This attachment type cannot be previewed inline. Use Download to save it.
              </span>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

function ImageEditError({ message }: { message: string }) {
  return (
    <p className="mt-3 rounded-sm border border-error-container bg-error-container/25 px-3 py-2 text-sm text-error">
      {message}
    </p>
  );
}

async function textFromDataUrl(dataUrl: string): Promise<string> {
  const response = await fetch(dataUrl);

  if (!response.ok) {
    throw new Error("Could not load attachment text.");
  }

  return response.text();
}

function aspectForPreset(preset: CropAspectPreset, naturalAspect: number): number {
  switch (preset) {
    case "square":
      return 1;
    case "wide":
      return 16 / 9;
    case "portrait":
      return 4 / 5;
    default:
      return Number.isFinite(naturalAspect) && naturalAspect > 0 ? naturalAspect : 1;
  }
}

async function croppedImageDataUrl(
  source: string,
  croppedAreaPixels: Area,
  mimeType: string,
): Promise<string> {
  const image = await loadImage(source);
  const canvas = document.createElement("canvas");
  const width = Math.max(1, Math.round(croppedAreaPixels.width));
  const height = Math.max(1, Math.round(croppedAreaPixels.height));
  const context = canvas.getContext("2d");

  if (!context) {
    throw new Error("This browser could not prepare the cropped image.");
  }

  canvas.width = width;
  canvas.height = height;
  context.drawImage(
    image,
    croppedAreaPixels.x,
    croppedAreaPixels.y,
    width,
    height,
    0,
    0,
    width,
    height,
  );

  return canvas.toDataURL(mimeType);
}

async function redactedImageDataUrl(
  source: string,
  redactions: RedactionRect[],
  mimeType: string,
): Promise<string> {
  const image = await loadImage(source);
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");

  if (!context) {
    throw new Error("This browser could not prepare the redacted image.");
  }

  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  context.drawImage(image, 0, 0);
  context.fillStyle = "#000000";

  for (const redaction of redactions) {
    context.fillRect(
      Math.round(redaction.x),
      Math.round(redaction.y),
      Math.round(redaction.width),
      Math.round(redaction.height),
    );
  }

  return canvas.toDataURL(mimeType);
}

function loadImage(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();

    image.addEventListener("load", () => resolve(image), { once: true });
    image.addEventListener("error", () => reject(new Error("The image could not be loaded.")), {
      once: true,
    });
    image.src = source;
  });
}

async function imageAttachmentFromDataUrl(
  attachment: ChatAttachment,
  dataUrl: string,
): Promise<ChatAttachment> {
  const blob = await dataUrlToBlob(dataUrl);

  return {
    ...attachment,
    dataUrl,
    mimeType: blob.type || outputImageMimeType(attachment),
    size: blob.size,
  };
}

async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  const response = await fetch(dataUrl);

  if (!response.ok) {
    throw new Error("Could not prepare the edited image.");
  }

  return response.blob();
}

function outputImageMimeType(attachment: ChatAttachment): string {
  return attachment.mimeType === "image/jpeg" || attachment.mimeType === "image/webp"
    ? attachment.mimeType
    : "image/png";
}

function naturalPointFromPointer(
  event: PointerEvent<HTMLDivElement>,
  naturalImageSize: NaturalImageSize,
): Point | null {
  const rect = event.currentTarget.getBoundingClientRect();

  if (rect.width <= 0 || rect.height <= 0) {
    return null;
  }

  const x = clamp(event.clientX - rect.left, 0, rect.width);
  const y = clamp(event.clientY - rect.top, 0, rect.height);

  return {
    x: (x / rect.width) * naturalImageSize.width,
    y: (y / rect.height) * naturalImageSize.height,
  };
}

function rectFromPoints(start: Point, end: Point): RedactionRect {
  return {
    height: Math.abs(end.y - start.y),
    id: createRedactionId(),
    width: Math.abs(end.x - start.x),
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
  };
}

function redactionStyle(
  redaction: RedactionRect,
  naturalImageSize: NaturalImageSize | null,
): CSSProperties {
  if (!naturalImageSize) {
    return {};
  }

  return {
    height: `${(redaction.height / naturalImageSize.height) * 100}%`,
    left: `${(redaction.x / naturalImageSize.width) * 100}%`,
    top: `${(redaction.y / naturalImageSize.height) * 100}%`,
    width: `${(redaction.width / naturalImageSize.width) * 100}%`,
  };
}

function createRedactionId(): string {
  const randomValue =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2);

  return `redaction-${randomValue}`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function formatFileSize(size: number): string {
  if (size < 1024) {
    return `${size} B`;
  }

  if (size < 1024 * 1024) {
    return `${Math.round(size / 1024)} KB`;
  }

  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}
