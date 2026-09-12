import { useRef, useState, type KeyboardEvent } from "react";

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

  // Escape and blur both end an edit, but only one of them commits. A native
  // blur fires after the Escape handler runs, so without this flag abandoning
  // an edit would still write the draft through.
  const abandoned = useRef(false);

  function commit(raw: string) {
    const next = validate(raw);
    if (next !== null) onCommit(next);

    // Dropped either way: on success the parent's new `value` takes over, and
    // on failure falling back to `value` *is* the snap-back.
    setDraft(null);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      // Blur does the committing, so both paths run identical code.
      event.currentTarget.blur();
      return;
    }

    if (event.key === "Escape") {
      abandoned.current = true;
      setDraft(null);
      event.currentTarget.blur();
    }
  }

  return (
    <span className="inline-flex items-baseline justify-end gap-1 whitespace-nowrap">
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
          if (abandoned.current) {
            abandoned.current = false;
            return;
          }
          commit(event.target.value);
        }}
        onKeyDown={handleKeyDown}
        className={[
          // Borderless and transparent so an untouched table reads as text.
          "rounded-sm border border-transparent bg-transparent px-1 py-0.5 text-right tabular-nums",
          // Focus is where it stops pretending to be text.
          "focus:border-neutral-400 focus:bg-white focus:outline-none",
          // Spin buttons would eat the width the price column needs at 360 px.
          "[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none",
          className ?? "",
        ].join(" ")}
      />
      {unit !== undefined && <span className="text-neutral-500">{unit}</span>}
    </span>
  );
}
