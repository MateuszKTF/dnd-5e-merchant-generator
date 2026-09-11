/**
 * In-memory `StorageLike` fakes, including ones that fail on purpose.
 *
 * The failure variants are the reason the storage object is injected at all:
 * a disabled store and a full one are the two conditions the PRD guardrail
 * turns on, and neither can be exercised by hand without deliberately breaking
 * a browser. With these they are ordinary unit tests.
 *
 * This file lives in `src/lib/` rather than a test folder so the Vitest glob
 * (`src/**\/*.test.ts`) and the `@/*` alias both reach it with no config
 * change. The `.test-helper.ts` suffix keeps it *out* of that glob — a file the
 * runner collected but which declares no tests is a failure, not a helper.
 */

import type { StorageLike } from "./merchant-storage";

export interface StorageFake extends StorageLike {
  /** The backing map, for asserting on raw bytes rather than through the module. */
  readonly entries: Map<string, string>;
}

/**
 * Which keys a failure applies to: an explicit list, `true` for every key, or a
 * predicate.
 *
 * The predicate form exists for the quarantine side key, whose name carries a
 * timestamp and so cannot be listed up front. Being able to fail *only* that key
 * is what makes the worst case testable: a store too full to hold a second copy
 * of the payload, which is precisely when discarding the corrupt original would
 * destroy recoverable data.
 */
export type KeyRule = readonly string[] | true | ((key: string) => boolean);

export interface StorageFakeOptions {
  /** Initial contents, written directly — no validation, so garbage is allowed. */
  readonly seed?: Readonly<Record<string, string>>;
  /**
   * Keys whose `setItem` throws a `QuotaExceededError`, i.e. a full store.
   * `true` means every key.
   */
  readonly quotaExceededOn?: KeyRule;
  /**
   * Keys whose `setItem` throws a plain `SecurityError`, i.e. a store the
   * browser exposes but refuses to write — Safari private mode. `true` means
   * every key, which is how a disabled store behaves.
   */
  readonly throwOn?: KeyRule;
  /**
   * Keys whose `getItem` throws, i.e. a browser with site data blocked, where
   * even reading is refused rather than returning `null`.
   */
  readonly throwOnGet?: KeyRule;
}

function matches(key: string, rule: KeyRule | undefined): boolean {
  if (rule === undefined) {
    return false;
  }
  if (rule === true) {
    return true;
  }
  if (typeof rule === "function") {
    return rule(key);
  }

  return rule.includes(key);
}

/**
 * A `StorageLike` backed by a `Map`.
 *
 * `DOMException` is used for the throws rather than a bare `Error` because the
 * module distinguishes a full store from a disabled one by the exception's
 * `name`, and a fake that threw the wrong type would let that branch pass
 * untested.
 */
export function createStorageFake(options: StorageFakeOptions = {}): StorageFake {
  const entries = new Map<string, string>(Object.entries(options.seed ?? {}));

  return {
    entries,

    getItem(key) {
      if (matches(key, options.throwOnGet)) {
        throw new DOMException(`Read of "${key}" refused`, "SecurityError");
      }

      return entries.get(key) ?? null;
    },

    setItem(key, value) {
      if (matches(key, options.quotaExceededOn)) {
        throw new DOMException(`Quota exceeded writing "${key}"`, "QuotaExceededError");
      }
      if (matches(key, options.throwOn)) {
        throw new DOMException(`Write to "${key}" refused`, "SecurityError");
      }

      entries.set(key, value);
    },

    removeItem(key) {
      entries.delete(key);
    },
  };
}
