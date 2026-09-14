import { describe, expect, it } from "vitest";

import { isStandingCondition, type StorageCondition } from "@/components/StorageNotice";

/**
 * The standing-versus-episodic policy, asserted against the rule rather than the list.
 *
 * `StorageNotice.tsx` states the rule in prose: a **standing** condition
 * describes something that is still true after a successful write; an
 * **episodic** one describes an attempt that the next landed write disproves.
 * `STANDING` itself is module-private, and deliberately so — a test that read it
 * would be an implementation mirror, green for any list the module happened to
 * hold.
 *
 * So the table below is written from the rule, one condition at a time, by
 * asking a single question of each: **after a write that lands, is this still
 * true?** Each row carries the reasoning that produced its answer. Nothing here
 * was read off the module.
 *
 * This is the same construction as the transition table in
 * `merchant-session.test.ts` — an independent literal is what makes an
 * assertion an oracle instead of an echo.
 */
const STILL_TRUE_AFTER_A_LANDED_WRITE: Readonly<Record<StorageCondition, boolean>> = {
  // The store had no room for that write. Freeing space ends it, and a later
  // write landing is the proof.
  "quota-exceeded": false,

  // There was no store to write to. If a write lands, there is one now.
  unavailable: false,

  // A newer build wrote the document and this one latched read-only to avoid
  // stripping fields it cannot see. The latch lasts the page load, so no write
  // can land to disprove it — and if one did, the newer data would be gone.
  "future-version": true,

  // The document predates this build's schema and no migration exists. Same
  // latch, same page-load lifetime.
  "needs-migration": true,

  // The document could not be read and could not be set aside. The bytes are
  // still unreadable after any later write.
  unreadable: true,

  // The store refuses writes for this page load. Nothing can land to clear it;
  // that is the condition.
  "write-refused": true,

  // The unreadable document was copied aside and the main key reset. The copy
  // still sits there afterwards, and the GM has not been told what was in it.
  quarantined: true,

  // Records failed validation and were dropped from the document. The next write
  // that lands is what makes the drop permanent — the worst possible moment to
  // stop saying so.
  "records-dropped": true,

  // Another tab replaced the merchant on screen, discarding this tab's manual
  // corrections. A later write saves whatever is on screen now; it does not
  // bring back the overlay that was overwritten. Still true, and the GM's own
  // next correction is the write that would otherwise erase the news.
  superseded: true,

  // The saved record this tab had open was deleted elsewhere. Saving again
  // creates a different record; the deleted one stays deleted.
  "record-gone": true,
};

describe("standing versus episodic storage conditions", () => {
  const entries = Object.entries(STILL_TRUE_AFTER_A_LANDED_WRITE) as [StorageCondition, boolean][];

  it.each(entries)("%s is classified by whether it outlives a landed write", (condition, stillTrue) => {
    expect(isStandingCondition(condition)).toBe(stillTrue);
  });

  it("classifies a loss the GM cannot undo as standing, so their next edit does not erase the news", () => {
    // The two that motivated this file. `clearEpisodic` runs on every successful
    // write, so an episodic classification here means the notice reporting an
    // irreversible loss is wiped by the correction the GM makes next — which is
    // the PRD guardrail ("zapisany kupiec nigdy nie znika po cichu") failing at
    // the reporting layer rather than the storage layer.
    expect(isStandingCondition("superseded")).toBe(true);
    expect(isStandingCondition("record-gone")).toBe(true);
  });

  it("keeps a recoverable attempt episodic, so a success the GM can see is not contradicted", () => {
    // The other half of the rule. A banner telling the GM to free space after
    // they freed it teaches them to ignore banners.
    expect(isStandingCondition("quota-exceeded")).toBe(false);
    expect(isStandingCondition("unavailable")).toBe(false);
  });
});
