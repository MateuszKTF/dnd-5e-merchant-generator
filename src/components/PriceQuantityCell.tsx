import { useState, type KeyboardEvent } from "react";

import { cn } from "@/lib/utils";

interface Props {
  /** The value to show when not being edited — already merged with any correction. */
  readonly value: number;
  /** Static suffix rendered beside the field. Omitted for quantity. */
  readonly unit?: string;
  /** Accessible name identifying the column and the row, e.g. "Cena — Bag of Holding". */
  readonly label: string;
  /** Turns the raw draft into a committable value, or `null` if it is unusable. */
  readonly validate: (draft: string) => number | null;
  readonly onCommit: (value: number) => void;
  /** `numeric` for whole counts, `decimal` for prices — picks the mobile keypad. */
  readonly inputMode: "numeric" | "decimal";
  /**
   * Granularity. Prices need `"any"`: the default step of 1 makes a fractional
   * price like 3.6 count as invalid input, which paints the field with the
   * browser's error styling and lets the steppers round it away.
   */
  readonly step: "any" | "1";
  /** Field width. The two columns differ: a quantity is two digits, a price is six. */
  readonly className?: string;
}

/**
 * One editable number in the assortment table.
 *
 * Reads as plain table text until it is focused, then becomes visibly a field.
 * Shared by the Ilość and Cena columns so the two can never drift apart in
 * behaviour — a GM who learns that Escape abandons an edit in one column is
 * right about the other.
 *
 * **A corrected cell is no longer marked.** S-02 gave it an amber dashed
 * underline meaning "you set this, not the generator". Amber is also this app's
 * colour for storage trouble, so it read as a warning — and once corrections
 * save themselves, the other available reading ("unsaved") became flatly false.
 * The distinction between drawn and hand-set values is gone from the table with
 * it; that is the accepted cost, decided 2026-09-12.
 *
 * The in-progress text is held here as a **local draft** and only committed on
 * blur or Enter. That is what makes snap-back possible: without it, typing `2`
 * on the way to `20` would already have been written to the correction overlay,
 * and an unusable draft would have no previous value left to restore.
 *
 * The draft doubles as the record of whether an edit is open at all, and the
 * blur handler reads it that way: no draft, nothing to commit. That is what
 * keeps a GM who merely tabs through the table from rewriting the storage
 * document 50 times, and it is why Enter and Escape can end an edit in place
 * without blurring — neither needs a flag to suppress the blur that follows.
 */
export default function PriceQuantityCell({
  value,
  unit,
  label,
  validate,
  onCommit,
  inputMode,
  step,
  className,
}: Props) {
  // `null` means "not being edited" — the field shows `value`. A string is an
  // edit in progress, including the empty string when the GM clears the field.
  const [draft, setDraft] = useState<string | null>(null);

  function commit(raw: string) {
    const next = validate(raw);
    if (next !== null) onCommit(next);

    // Dropped either way: on success the parent's new `value` takes over, and
    // on failure falling back to `value` *is* the snap-back.
    setDraft(null);
  }

  // Neither key blurs. Blurring would drop focus to `<body>`, so the next Tab
  // restarts at the top of the document — and in a 25-row table a GM who
  // commits row 14 with Enter would be thrown back to the first control on the
  // page. Both keys end the edit and leave the caret where it is.
  //
  // Ending an edit always means `draft = null`, which is exactly what tells the
  // blur handler there is nothing left to commit. That is why neither key needs
  // a flag to suppress the blur that follows.
  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      commit(event.currentTarget.value);
      return;
    }

    if (event.key === "Escape") {
      setDraft(null);
    }
  }

  // items-center, not items-baseline: the input is now 44px tall, and
  // baseline-aligning a short unit label against a tall box drops it below the
  // number it belongs to.
  return (
    <span className="inline-flex items-center justify-end gap-1 whitespace-nowrap">
      <input
        type="number"
        inputMode={inputMode}
        step={step}
        aria-label={label}
        value={draft ?? String(value)}
        onChange={(event) => {
          setDraft(event.target.value);
        }}
        onFocus={(event) => {
          // Correcting a value means replacing it, not appending to it.
          event.currentTarget.select();
        }}
        onBlur={(event) => {
          // No draft means nothing was typed since the last commit — either the
          // GM only tabbed through, or Enter/Escape already ended the edit.
          // Committing anyway would rewrite the storage document over nothing.
          if (draft === null) return;
          commit(event.target.value);
        }}
        onKeyDown={handleKeyDown}
        // `cn`, not a join: the table passes width utilities through
        // `className`, and only tailwind-merge makes a caller's utility beat
        // the baked-in one instead of leaving stylesheet order to decide.
        className={cn(
          // Borderless and transparent so an untouched table reads as text.
          // min-h-11 matches the 44px tap target the selects and buttons use:
          // there are up to 50 of these on a 25-row list, and they are the only
          // controls inside the table the phone NFR is about.
          "min-h-11 rounded-sm border border-transparent bg-transparent px-1 py-0.5 text-right tabular-nums",
          // Focus is where it stops pretending to be text. The border alone
          // cannot carry that: neutral-400 is ~2.6:1 on white, under the 3:1
          // floor AGENTS.md sets for control borders, and there are up to 50
          // of these tab stops in one table. So the border goes to the
          // neutral-500 the selects use and an outline does the real work —
          // focus-visible, so a tap does not draw a ring the GM did not ask for.
          "focus:border-neutral-500",
          "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-neutral-800",
          // Spin buttons would eat the width the price column needs at 360 px.
          "[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none",
          className,
        )}
      />
      {unit !== undefined && <span className="text-neutral-500">{unit}</span>}
    </span>
  );
}
