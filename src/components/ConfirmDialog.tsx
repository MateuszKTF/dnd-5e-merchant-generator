import { useLayoutEffect, useRef, type MouseEvent, type SyntheticEvent } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

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

  // Layout, not passive: this synchronises the DOM with `open`, and it has to
  // land in the same frame as the render that changed it. A passive effect runs
  // after paint, so a caller that recomputes its copy from a cleared pending
  // action — as this one's does — would show the fallback text inside a dialog
  // the browser has not closed yet, and a delete confirmation would be seen
  // turning into a regenerate confirmation on its way out.
  useLayoutEffect(() => {
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
      // The body, not just the title. Focus lands on Cancel the moment the
      // dialog opens, so without this a screen reader announces the dialog's
      // name and the focused button — and the sentence naming what is about to
      // be destroyed is never guaranteed to be read. For a delete that sentence
      // is the only place the merchant's name appears.
      aria-describedby="confirm-dialog-body"
      onCancel={handleCancelEvent}
      // Backstop, not a path anything takes today: every close currently goes
      // through `onCancel`. But if the DOM ever closes without React hearing
      // about it, `open` stays `true`, the effect's deps never change so it
      // never re-runs, and the gate becomes permanently un-openable — the
      // guardrail silently off. Reconciling here makes that unreachable rather
      // than merely unused.
      onClose={() => {
        if (open) onCancel();
      }}
      onClick={handleBackdropClick}
      // p-0 so the only clickable part of the dialog element is the backdrop.
      // The inset margins keep the panel clear of the screen edge at 360 px.
      // `bg-white` stated rather than inherited: every other surface in this
      // project names its own background, and a bare `<dialog>` would otherwise
      // take the UA's `Canvas`, which nothing here controls. The scrim is
      // `neutral-900`, not `black` — the palette has no black in it.
      className="m-auto w-[calc(100%-2rem)] max-w-sm rounded-lg bg-white p-0 shadow-xl backdrop:bg-neutral-900/40"
    >
      <div className="flex flex-col gap-3 p-5">
        <h2 id="confirm-dialog-title" className="text-base font-semibold">
          {title}
        </h2>
        <p id="confirm-dialog-body" className="text-sm text-neutral-600">
          {body}
        </p>

        {/* Cancel first in the DOM so it takes focus, and so the damaging
            action sits where the thumb is least likely to land by accident. */}
        <div className="mt-2 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          {/* The border colour is stated here because `outline` does not carry
              one — it falls through to the base `border-border` rule, which is
              ~1.2:1 on white. This is the safe action and the one that takes
              focus on a destructive dialog, so it cannot be the button that
              reads as unstyled text. `neutral-500` is the 3:1 floor AGENTS.md
              sets, and what the selects use. */}
          <Button ref={cancelRef} variant="outline" className="h-11 border-neutral-500 bg-white" onClick={onCancel}>
            {cancelLabel}
          </Button>
          {/* Colours stated here rather than left to the variant, which falls
              through to `bg-destructive` / `bg-primary` — the shadcn token family
              AGENTS.md bans, and the same fallthrough the Cancel button below
              already had to work around. `red-700` is the palette's semantic
              destructive accent and the same one the library row's delete
              control uses, so the two read as the same action. */}
          <Button
            variant={destructive ? "destructive" : "default"}
            className={cn("h-11", destructive ? "bg-red-700 text-white hover:bg-red-800" : undefined)}
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </dialog>
  );
}
