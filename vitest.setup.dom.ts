import "@testing-library/jest-dom/vitest";

import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

/**
 * Setup for the `dom` project only — see `vitest.config.ts`.
 *
 * Testing Library registers its own `afterEach(cleanup)` only when a global
 * `afterEach` already exists at import time. That depends on `globals`, which is
 * set for this project but is not something a test file should have to reason
 * about, so cleanup is wired explicitly here. Calling it twice is harmless;
 * calling it zero times leaks every render into the next test.
 */
afterEach(() => {
  cleanup();
});

/**
 * `<dialog>` stubs — and a warning about what they are not.
 *
 * jsdom does not implement `HTMLDialogElement`: its impl class is an empty body
 * (jsdom#3294, still open). Without these stubs any component that opens a
 * dialog throws on render, which would put `ConfirmDialog`'s whole subtree out
 * of reach even for tests that never open it.
 *
 * **These stubs remove exactly the behaviour they appear to provide.** They
 * toggle the `open` attribute and nothing else — no top layer, no focus trap, no
 * Escape-to-cancel, no inert background, no `::backdrop`. Those are the
 * interesting parts of a modal and the parts most likely to regress.
 *
 * So: no test may claim to cover modal semantics through this stub. Focus
 * trapping, Escape handling and backdrop dismissal are browser-only, and belong
 * to §3 Phase 5 of `context/foundation/test-plan.md`, which has a real browser.
 * What the stub buys is the ability to render a tree that *contains* a dialog.
 */
// Reached through a loose record on purpose. TypeScript's DOM lib declares both
// methods as always present — that is the whole problem being worked around, and
// typing the prototype honestly here is what lets the runtime check compile.
const dialogPrototype = HTMLDialogElement.prototype as unknown as Record<string, unknown>;

if (typeof dialogPrototype.showModal !== "function") {
  dialogPrototype.showModal = function showModal(this: HTMLDialogElement): void {
    this.open = true;
  };
}

if (typeof dialogPrototype.close !== "function") {
  dialogPrototype.close = function close(this: HTMLDialogElement, returnValue?: string): void {
    this.open = false;
    if (returnValue !== undefined) {
      this.returnValue = returnValue;
    }
    this.dispatchEvent(new Event("close"));
  };
}
