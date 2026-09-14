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
 * | # | Entry | Defect | Owner |
 * |---|-------|--------|-------|
 * | 1 | `MerchantGenerator.test.tsx` → "points the GM at a storage message that exists" | A failed promote answers `not-found`, which `conditionFromFailure` maps to `null`, so no storage notice renders — while the assistive announcement tells the GM to read one. Net visible change for a sighted GM: nothing. | Follow-up defect-fix change; see `context/foundation/test-plan.md` §2 Risk #1 |
 */
const EXPECTED_QUARANTINE_ENTRIES = 1;

const SRC = fileURLToPath(new URL(".", import.meta.url));

/** This file talks *about* the marker, so it must never count itself. */
const SELF = "quarantine.test.ts";

const MARKER = ["it", "fails("].join(".");

function testFilesUnder(directory: string): string[] {
  const found: string[] = [];

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);

    if (entry.isDirectory()) {
      found.push(...testFilesUnder(path));
      continue;
    }
    if (entry.name === SELF) continue;
    if (/\.test\.tsx?$/.test(entry.name)) found.push(path);
  }

  return found;
}

function quarantineEntries(): { file: string; count: number }[] {
  return testFilesUnder(SRC)
    .map((file) => ({
      file: file.slice(SRC.length).replace(/\\/g, "/"),
      count: readFileSync(file, "utf8").split(MARKER).length - 1,
    }))
    .filter((entry) => entry.count > 0);
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
    // Without this, an entry count of zero is indistinguishable from a broken
    // scanner, and the gate would pass forever while covering nothing (L-04).
    const files = testFilesUnder(SRC);

    expect(files.length).toBeGreaterThan(0);
    expect(quarantineEntries().length).toBeGreaterThan(0);
  });
});
