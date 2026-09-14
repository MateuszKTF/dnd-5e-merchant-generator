import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * The quarantine ledger.
 *
 * Known defects are parked with `it.fails()` rather than `it.skip()`: a skipped
 * test never executes and rots silently, which is the failure mode lessons L-03
 * and L-05 both record. An `it.fails()` entry runs its assertion, keeps the
 * suite green while the defect stands, and turns red the moment anyone fixes the
 * defect — so the entry has to be retired rather than forgotten.
 *
 * What `it.fails()` cannot do is stop the *list* from growing. Parking a defect
 * is a decision, and this gate makes it a deliberate one: adding an entry means
 * editing the number below and naming the defect here.
 *
 * This is the shape lessons L-04 says to insist on — a gate that demonstrably
 * covers something, rather than one whose presence in a config implies it does.
 */

/**
 * Every parked defect, why it is parked, and who owns it.
 *
 * **Currently empty, and that is the desired state.** Two entries have lived
 * here, and both graduated the day they were parked — which is the lifecycle
 * this file is built for, not an accident:
 *
 * 1. A failed promote answered `not-found`, which mapped to no condition, so no
 *    storage notice rendered while the assistive announcement told the GM to
 *    read one. Parked 2026-09-14, fixed the same day — now an ordinary passing
 *    test in `MerchantGenerator.test.tsx`.
 * 2. The primary "Stwórz" button painted no keyboard focus indicator a GM could
 *    see: the shadcn button base sets `outline-none` and substitutes a ring
 *    that resolves to a transparent shadow, measuring 1.2:1 against the 3:1
 *    floor. Parked 2026-09-14, fixed the same day — now an ordinary passing
 *    test in `tests/e2e/critical-screen-focus.spec.ts`.
 *
 * | # | Entry | Defect | Owner |
 * |---|-------|--------|-------|
 * | — | (none) | — | — |
 */
const EXPECTED_QUARANTINE_ENTRIES = 0;

const SRC = fileURLToPath(new URL(".", import.meta.url));

/**
 * The browser-level suite parks defects too, and it lives outside `src/` with a
 * different extension and a different marker. Scanning only `src/**` would let
 * an E2E park go unrecorded while this gate still reported a truthful-looking
 * count — a gate that covers less than it appears to, which is exactly the
 * L-04 shape this file exists to refuse.
 */
const E2E = fileURLToPath(new URL("../tests/e2e/", import.meta.url));

/** This file talks *about* the markers, so it must never count itself. */
const SELF = "quarantine.test.ts";

/** Vitest parks with `it.fails(`; Playwright parks with `test.fail(`. */
const MARKER = ["it", "fails("].join(".");
const E2E_MARKER = ["test", "fail("].join(".");

function filesUnder(directory: string, pattern: RegExp): string[] {
  const found: string[] = [];

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);

    if (entry.isDirectory()) {
      found.push(...filesUnder(path, pattern));
      continue;
    }
    if (entry.name === SELF) continue;
    if (pattern.test(entry.name)) found.push(path);
  }

  return found;
}

function testFilesUnder(directory: string): string[] {
  return filesUnder(directory, /\.test\.tsx?$/);
}

function e2eFilesUnder(directory: string): string[] {
  return filesUnder(directory, /\.spec\.ts$/);
}

/**
 * Count parks in one source file.
 *
 * The marker is anchored to the start of a line, so only a real call site
 * counts. A spec that *documents* its own parking convention mentions the
 * marker in prose — "parked with `test.fail()`, never `test.skip()`" — and a
 * bare substring search counts those too, inflating the total and forcing the
 * ledger number up to match comments rather than defects.
 */
function countIn(files: string[], root: string, marker: string): { file: string; count: number }[] {
  return files
    .map((file) => ({
      file: file.slice(root.length).replace(/\\/g, "/"),
      count: countCallSites(readFileSync(file, "utf8"), marker),
    }))
    .filter((entry) => entry.count > 0);
}

function countCallSites(source: string, marker: string): number {
  const atLineStart = new RegExp(`^[ \\t]*${marker.replace(/[.()]/g, "\\$&")}`, "gm");
  return source.match(atLineStart)?.length ?? 0;
}

function quarantineEntries(): { file: string; count: number }[] {
  return [...countIn(testFilesUnder(SRC), SRC, MARKER), ...countIn(e2eFilesUnder(E2E), E2E, E2E_MARKER)];
}

describe("quarantined defects", () => {
  it("are exactly as many as the ledger above records", () => {
    const total = quarantineEntries().reduce((sum, entry) => sum + entry.count, 0);

    // If this fails high: a defect was parked without being written down. Add it
    // to the table above, with an owner, and bump the number.
    // If this fails low: a defect was fixed — remove its row and bump the number
    // down. That is the entry graduating, which is the point.
    expect(total).toBe(EXPECTED_QUARANTINE_ENTRIES);
  });

  it("guards its own premise: it can actually see the marker it counts", () => {
    // An expected count of zero is the dangerous state for this gate: zero found
    // is indistinguishable from a scanner that finds nothing ever, and the gate
    // would pass forever while covering nothing (L-04). So the premise is
    // checked in two independent halves, neither of which depends on a real
    // entry existing.

    // 1. The scanner reaches real files, of both extensions. If either drops to
    //    zero the path or the pattern broke, and the count above is meaningless.
    const files = testFilesUnder(SRC);

    expect(files.length).toBeGreaterThan(5);
    expect(files.filter((file) => file.endsWith(".test.tsx")).length).toBeGreaterThan(0);
    expect(files.filter((file) => file.endsWith(".test.ts")).length).toBeGreaterThan(0);

    // 1b. And it reaches the browser-level suite, which lives outside `src/`
    //     under a different extension. A broken path here would silently stop
    //     counting every E2E park while the total still looked plausible.
    expect(e2eFilesUnder(E2E).length).toBeGreaterThan(0);

    // 2. The counting logic recognises both markers when they are present.
    //    Exercised against synthetic source strings rather than a parked
    //    defect, so the check keeps working when either ledger half is empty.
    const synthetic = `it("a", () => {});\n  ${MARKER}"b", () => {});\n${MARKER}"c", () => {});`;

    expect(countCallSites(synthetic, MARKER)).toBe(2);

    const syntheticE2e = `test("a", () => {});\n  ${E2E_MARKER}"b", () => {});`;

    expect(countCallSites(syntheticE2e, E2E_MARKER)).toBe(1);

    // 3. And it does NOT count the marker in prose. Both ledger halves document
    //    their own convention in comments, so a substring search would count
    //    those and the number above would track comments, not defects.
    const prose = ` * parked with \`${E2E_MARKER})\`, never \`test.skip()\` — see the ledger.`;

    expect(countCallSites(prose, E2E_MARKER)).toBe(0);
  });
});
