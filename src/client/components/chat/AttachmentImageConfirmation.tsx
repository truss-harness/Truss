import { MaterialIcon } from "../MaterialIcon.tsx";

export interface LargeImageAttachmentConfirmationState {
  attachmentId: string;
  fileName: string;
  pageCount: number;
}

export function LargeImageAttachmentConfirmation({
  confirmation,
  disabled,
  onCancel,
  onConfirm,
}: {
  confirmation: LargeImageAttachmentConfirmationState;
  disabled: boolean;
  onCancel(): void;
  onConfirm(): void;
}) {
  return (
    <div className="mx-auto w-full max-w-[980px] rounded-sm border border-outline-variant bg-secondary-container/45 px-4 py-3 text-on-secondary-container shadow-[0_12px_30px_rgb(60_50_30/0.12)]">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-sm bg-surface text-primary">
          <MaterialIcon name="warning" size={20} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold">
            Render {confirmation.pageCount} page images?
          </span>
          <span className="mt-1 block break-words text-xs leading-5 text-on-surface-variant">
            {confirmation.fileName} will be attached as {confirmation.pageCount} separate
            images. Attaching too many images might hurt performance or inflate pricing on
            cloud models.
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-2 sm:pt-0.5">
          <button
            className="h-9 rounded-sm border border-outline-variant bg-surface px-3 text-xs font-semibold text-on-surface transition hover:border-outline hover:bg-surface-container-low disabled:cursor-not-allowed disabled:opacity-60"
            disabled={disabled}
            onClick={onCancel}
            type="button"
          >
            Cancel
          </button>
          <button
            className="h-9 rounded-sm bg-primary px-3 text-xs font-semibold text-on-primary shadow-[0_4px_12px_rgb(36_36_33/0.14)] transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={disabled}
            onClick={onConfirm}
            type="button"
          >
            Continue
          </button>
        </span>
      </div>
    </div>
  );
}
