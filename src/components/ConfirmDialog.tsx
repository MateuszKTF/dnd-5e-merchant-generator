import { useEffect, useRef, type MouseEvent, type SyntheticEvent } from "react";

import { Button } from "@/components/ui/button";

interface Props {
  readonly open: boolean;
  readonly title: string;
  readonly body: string;
  readonly confirmLabel: string;
  readonly cancelLabel: string;
  /** Marks the confirming action as the damaging one. Steers styling and focus. */
  readonly destructive?: boolean;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}

/**
 * Ask before doing something the user cannot undo.
 *
 * Built on the native `<dialog>` element, so focus trapping, focus restoration
 * on close, Escape handling and a backdrop all arrive without a new dependency
 * — `@radix-ui/react-slot` is the only Radix package in the project and there
 * is no dialog primitive to reach for.
 *
 * Generic on purpose, despite having one caller today. S-04
 * (`saved-merchants-library`) needs the same gate when opening a saved merchant
 * over unsaved corrections, and S-05 (`merchant-search-and-delete`) needs it
 * again to confirm a delete. Naming it for the job rather than for its first
 * caller removes two renames and two call-site sweeps from slices that already
 * carry deadline exposure. Copy therefore comes from the caller, never baked in.
 */
export default function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  cancelLabel,
  destructive = false,
  onConfirm,
  onCancel,
}: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open && !dialog.open) {
      dialog.showModal();

      // A stray Enter must not fire the damaging action. `showModal` focuses the
      // first focusable descendant, which is already Cancel given the DOM order
      // below — this makes that guarantee explicit rather than incidental.
      if (destructive) cancelRef.current?.focus();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open, destructive]);

  /**
   * Escape fires `cancel` on the element itself, entirely separately from the
   * Cancel button's click handler. Wiring only the button would leave Escape
   * closing the dialog while the caller still believed it was open — which
   * reads to the GM as the Stwórz button having stopped working.
   */
  function handleCancelEvent(event: SyntheticEvent) {
    // React state owns `open`; let the effect above do the closing.
    event.preventDefault();
    onCancel();
  }

  /**
   * Clicking outside the panel. A native `<dialog>` does not light-dismiss, and
   * the attribute that enables it is too new to rely on — but a click on the
   * backdrop targets the dialog element itself, which the inner panel never
   * does. Same outcome as Escape: do nothing.
   */
  function handleBackdropClick(event: MouseEvent<HTMLDialogElement>) {
    if (event.target === event.currentTarget) onCancel();
  }

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="confirm-dialog-title"
      onCancel={handleCancelEvent}
      onClick={handleBackdropClick}
      // p-0 so the only clickable part of the dialog element is the backdrop.
      // The inset margins keep the panel clear of the screen edge at 360 px.
      className="m-auto w-[calc(100%-2rem)] max-w-sm rounded-lg p-0 shadow-xl backdrop:bg-black/40"
    >
      <div className="flex flex-col gap-3 p-5">
        <h2 id="confirm-dialog-title" className="text-base font-semibold">
          {title}
        </h2>
        <p className="text-sm text-neutral-600">{body}</p>

        {/* Cancel first in the DOM so it takes focus, and so the damaging
            action sits where the thumb is least likely to land by accident. */}
        <div className="mt-2 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button ref={cancelRef} variant="outline" className="h-11 sm:h-10" onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button variant={destructive ? "destructive" : "default"} className="h-11 sm:h-10" onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </dialog>
  );
}
