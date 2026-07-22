import { useEffect, useId, useRef } from "react";
import type { MouseEvent, ReactNode } from "react";
import { createPortal } from "react-dom";
import { MaterialIcon } from "./MaterialIcon.tsx";

type ModalSize = "sm" | "md" | "lg" | "xl";

export function Modal({
  bodyClassName = "",
  children,
  className = "",
  closeLabel = "Close dialog",
  description,
  footer,
  headerActions,
  headerTabs,
  icon,
  onClose,
  open,
  restoreFocus = true,
  role = "dialog",
  size = "md",
  title,
}: {
  bodyClassName?: string;
  children: ReactNode;
  className?: string;
  closeLabel?: string;
  description?: string;
  footer?: ReactNode;
  headerActions?: ReactNode;
  headerTabs?: ReactNode;
  icon?: string;
  onClose(): void;
  open: boolean;
  restoreFocus?: boolean;
  role?: "dialog" | "alertdialog";
  size?: ModalSize;
  title: string;
}) {
  const titleId = useId();
  const descriptionId = useId();
  const panelRef = useRef<HTMLDivElement | null>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const previousActiveElement =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const originalOverflow = document.body.style.overflow;

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        onCloseRef.current();
      }
    }

    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", handleKeyDown);

    const animationFrame = window.requestAnimationFrame(() => {
      const focusTarget =
        panelRef.current?.querySelector<HTMLElement>("[data-autofocus='true']") ??
        panelRef.current?.querySelector<HTMLElement>(
          "button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])",
        );

      focusTarget?.focus();
    });

    return () => {
      window.cancelAnimationFrame(animationFrame);
      document.body.style.overflow = originalOverflow;
      document.removeEventListener("keydown", handleKeyDown);
      if (restoreFocus) {
        previousActiveElement?.focus();
      }
    };
  }, [open, restoreFocus]);

  if (!open || typeof document === "undefined") {
    return null;
  }

  function handleBackdropMouseDown(event: MouseEvent<HTMLDivElement>): void {
    if (event.target === event.currentTarget) {
      onClose();
    }
  }

  return createPortal(
    <div className="truss-modal-backdrop" onMouseDown={handleBackdropMouseDown}>
      <div
        aria-describedby={description ? descriptionId : undefined}
        aria-labelledby={titleId}
        aria-modal="true"
        className={["truss-modal-panel", `truss-modal-panel-${size}`, className]
          .filter(Boolean)
          .join(" ")}
        ref={panelRef}
        role={role}
      >
        <header
          className={["truss-modal-header", headerTabs ? "truss-modal-header-with-tabs" : ""]
            .filter(Boolean)
            .join(" ")}
        >
          <div className="truss-modal-header-main">
            <div className="truss-modal-heading">
              {icon ? (
                <span className="truss-modal-icon">
                  <MaterialIcon name={icon} size={18} />
                </span>
              ) : null}
              <div className="truss-modal-title-block">
                <h2 className="truss-modal-title" id={titleId}>
                  {title}
                </h2>
                {description ? (
                  <p className="truss-modal-description" id={descriptionId}>
                    {description}
                  </p>
                ) : null}
              </div>
            </div>
            <div className="truss-modal-actions">
              {headerActions}
              <button
                aria-label={closeLabel}
                className="truss-modal-close"
                onClick={onClose}
                title={closeLabel}
                type="button"
              >
                <MaterialIcon name="close" size={18} />
              </button>
            </div>
          </div>
          {headerTabs ? <div className="truss-modal-header-tabs">{headerTabs}</div> : null}
        </header>
        <div className={["truss-modal-body", bodyClassName].filter(Boolean).join(" ")}>
          {children}
        </div>
        {footer ? <footer className="truss-modal-footer">{footer}</footer> : null}
      </div>
    </div>,
    document.body,
  );
}
