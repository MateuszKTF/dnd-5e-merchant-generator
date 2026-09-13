/**
 * The one place a storage problem becomes something a GM can read.
 *
 * F-01 deliberately ships no UI: it answers every read and write with a typed
 * status instead of throwing, precisely so this slice can say *which* problem
 * occurred. Every case below means something genuinely different and implies a
 * different action, and collapsing them into "coś poszło nie tak" would throw
 * away the whole reason the contract is a discriminated union.
 */

/**
 * Everything the GM has to be told about, in the vocabulary of the thing that
 * happened rather than of the call that failed.
 *
 * `read-only` is present as `write-refused`, and the rename is the point. It
 * used to be absent on the reading that the latch is only ever engaged *by*
 * `future-version`, `needs-migration` or `unreadable`, so naming it would
 * replace a reason with its symptom. That reading was wrong: a store that
 * reads fine and refuses writes — Safari's private mode — latches on its own,
 * with no other condition on screen to explain it. It was reported as
 * `unavailable`, whose copy is about this device's settings and names no
 * remedy the GM can act on, because the latch outlives the page load and site
 * data was never the problem.
 *
 * `not-found` is absent as a *status* but present as `record-gone`, and the
 * difference is which call discovered it. On a promote it means the earlier
 * auto-persist failed and raised its own notice. On a **rename** it means
 * another tab deleted the record — nothing said so yet, and without a notice
 * the row simply reverts, reading as a rename that failed for no reason.
 */
export type StorageCondition =
  | "unavailable"
  | "quota-exceeded"
  | "future-version"
  | "needs-migration"
  | "records-dropped"
  | "record-gone"
  | "quarantined"
  | "unreadable"
  | "write-refused"
  | "superseded";

/**
 * The copy, in Polish, one entry per condition.
 *
 * Two distinctions are doing real work and must survive any edit:
 *
 * - `quarantined` says the unreadable data was **set aside and replaced**;
 *   `unreadable` says it is **still under the main key**. F-01 separates them
 *   because the second is the full-store-plus-corruption case, where the
 *   replacement could not be written. The message deliberately does not claim
 *   the data was or was not copied aside: `unreadable` is reached both when the
 *   copy failed and when the copy landed but the replacement did not, and the
 *   GM cannot act on the difference. What they can act on — the original is
 *   still there, free up space and it may be recoverable — is true in both.
 * - `unavailable` is about this device's settings, `quota-exceeded` about space.
 *   One is fixed by re-enabling site data, the other by deleting merchants.
 */
const MESSAGES: Record<StorageCondition, string> = {
  unavailable:
    "Zapisywanie jest wyłączone w tej przeglądarce. Generator działa normalnie, ale kupcy nie przetrwają zamknięcia karty.",
  "quota-exceeded":
    "Pamięć przeglądarki jest pełna — nie udało się zapisać kupca. Usuń zapisanych kupców, żeby zwolnić miejsce.",
  "future-version":
    "Na tym urządzeniu są dane zapisane przez nowszą wersję aplikacji. Nic nie zostanie zapisane, dopóki jej nie zaktualizujesz — istniejące dane zostają nietknięte.",
  // Unreachable at v1 — there is no format below it to migrate from. The
  // message exists so the day someone bumps the version, a GM whose device
  // holds an older document is told the truth instead of losing it silently.
  "needs-migration":
    "Na tym urządzeniu są dane zapisane przez starszą wersję aplikacji, a ta wersja nie potrafi ich jeszcze przenieść. Nic nie zostanie zapisane — istniejące dane zostają nietknięte.",
  // Named because the alternative is the guardrail failing in silence: those
  // records are gone from the list, and the next zapis utrwala listę bez nich.
  "records-dropped":
    "Części zapisanych kupców nie dało się odczytać i nie ma ich na liście. Reszta jest bezpieczna — ale następny zapis utrwali listę bez nich.",
  // Without this the row simply snapped back to its old name, which reads as
  // the rename having failed for no reason rather than as the record being gone.
  "record-gone": "Tego kupca już nie ma — usunięto go w innej karcie. Lista została odświeżona.",
  quarantined:
    "Nie udało się odczytać zapisanych danych. Zostały odłożone na bok, a nie skasowane — nadal są w pamięci przeglądarki.",
  // Says that writing is off, like `future-version` does. Reaching this status
  // means F-01 latched read-only, and the latch lasts the page load — so the
  // remedy is "free space AND reload", not "free space". Without the clause the
  // GM reads a message about reading and presses a Save that cannot work.
  unreadable:
    "Nie udało się odczytać zapisanych danych. Nie zostały skasowane — wciąż są w pamięci przeglądarki tam, gdzie były. Nic nie zostanie zapisane do czasu odświeżenia strony: zwolnij miejsce i odśwież, żeby spróbować je odzyskać.",
  // Distinct from `unavailable`, and the distinction is the remedy. That one is
  // about this device's settings — re-enable site data and saving works again.
  // This one is a store that hands over everything it holds and refuses every
  // write, which is Safari's private mode: site data is not off, and there is
  // nothing to re-enable. F-01 latches on the read, and the latch lasts the
  // page load, so the reload clause is not advice — it is the only way back.
  "write-refused":
    "Ta przeglądarka nie pozwala nic zapisać — zwykle tryb prywatny. Zapisani kupcy są widoczni i generator działa normalnie, ale nic nowego nie zostanie zapisane do czasu odświeżenia strony poza trybem prywatnym.",
  superseded:
    "Inna karta zapisała innego kupca i to on jest teraz na ekranie. Ręczne korekty z tej karty zostały zastąpione.",
};

/**
 * Which conditions outlive a write that lands.
 *
 * A **standing** condition describes something that is still true after a
 * successful write: F-01 has latched and this build cannot write again without
 * a reload, or records are already gone from the list. Clearing one because a
 * later write succeeded would erase news the GM has not acted on — and in the
 * `records-dropped` case it is the successful write that makes the loss
 * permanent, so that is the worst possible moment to stop saying it.
 *
 * Everything else is **episodic**: it describes an attempt, not a state. A full
 * store, a disabled one, another tab replacing the merchant, a record deleted
 * underneath a rename — each may already be over, and the next write that lands
 * is proof. A banner telling the GM to free space *after* they freed it
 * contradicts a success they can see, which teaches them to ignore the banner
 * that matters.
 */
const STANDING: readonly StorageCondition[] = [
  "future-version",
  "needs-migration",
  "unreadable",
  // Standing for the same reason as the three above: F-01 latched on the read,
  // and the latch lasts the page load. Clearing it on a later successful write
  // would be doubly wrong here — there is no later successful write to clear it
  // with, since every one of them is refused.
  "write-refused",
  "quarantined",
  "records-dropped",
];

export function isStandingCondition(condition: StorageCondition): boolean {
  return STANDING.includes(condition);
}

/**
 * Display order, so two conditions on screen at once always read the same way.
 *
 * Standing first: they explain why the episodic one happened. A store that
 * refuses writes *and* dropped records is the pair this order exists for —
 * `readDocument` carries `dropped` on its `read-only` branch precisely so the
 * loss is not silent for the GM who cannot re-save to recover, and a
 * single-slot notice was throwing one of the two away.
 */
const ORDER: readonly StorageCondition[] = [
  "future-version",
  "needs-migration",
  "unreadable",
  "write-refused",
  "quarantined",
  "records-dropped",
  "unavailable",
  "quota-exceeded",
  "record-gone",
  "superseded",
];

interface Props {
  /** Empty when there is nothing wrong — the ordinary case. Order is ignored. */
  readonly conditions: readonly StorageCondition[];
}

/**
 * Persistent, not a toast: a GM who looks away and misses it loses the session.
 *
 * Kept to one compact line per condition so it does not push the table below the
 * fold on a 360 px phone, which is where this product is actually used. Two at
 * once is rare and deliberate — see {@link ORDER} — and still cheaper than
 * dropping one of them.
 *
 * `role="status"` rather than `alert`: every one of these arrives after a page
 * load or a background event, and none of them interrupts what the GM is doing
 * — generating and editing keep working in all of them.
 */
export default function StorageNotice({ conditions }: Props) {
  // Filtered through `ORDER` rather than rendered as given: the call sites
  // raise conditions in whatever sequence the store reported them, and the GM
  // should not see the same two facts in a different order on a different load.
  const shown = ORDER.filter((condition) => conditions.includes(condition));
  const copy: Record<string, string | undefined> = MESSAGES;

  // **The region is always mounted, even with nothing to say.** A polite live
  // region has to be in the accessibility tree *before* its content changes;
  // inserting the region and its first message in one commit is the classic
  // case screen readers skip. Returning `null` here meant every one of these
  // messages — the only signal a GM gets that data was lost or cannot be
  // written — had a good chance of never being announced at all. The empty
  // wrapper paints nothing: the amber panel and its margin live inside.
  //
  // `MerchantTable` already does this; nothing would have caught the difference,
  // because `astro/jsx-a11y` never looks at `.tsx` (lessons L-04).
  return (
    <div role="status">
      {shown.length > 0 && (
        <div className="mt-4 space-y-1 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {shown.map((condition) => (
            // The fallback is against a caller who broke the contract, not a
            // hole in it — the same defence `nextSaveState` states, through the
            // same widened view, because the narrow type makes the `??` look
            // unreachable to the compiler and to the linter. Without it an
            // unknown condition renders an empty amber banner: an alarm with no
            // content, which is worse than the wrong message.
            <p key={condition}>{copy[condition] ?? MESSAGES.unreadable}</p>
          ))}
        </div>
      )}
    </div>
  );
}
