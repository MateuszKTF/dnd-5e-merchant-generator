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

export interface StorageFakeOptions {
  /** Initial contents, written directly — no validation, so garbage is allowed. */
  readonly seed?: Readonly<Record<string, string>>;
  /**
   * Keys whose `setItem` throws a `QuotaExceededError`, i.e. a full store.
   * `true` means every key.
   */
  readonly quotaExceededOn?: readonly string[] | true;
  /**
   * Keys whose `setItem` throws a plain `SecurityError`, i.e. a store the
   * browser exposes but refuses to write — Safari private mode. `true` means
   * every key, which is how a disabled store behaves.
   */
  readonly throwOn?: readonly string[] | true;
}

function matches(key: string, rule: readonly string[] | true | undefined): boolean {
  if (rule === undefined) {
    return false;
  }

  return rule === true || rule.includes(key);
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
