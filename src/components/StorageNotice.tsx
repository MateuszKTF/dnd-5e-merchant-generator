/**
 * The one place a storage problem becomes something a GM can read.
 *
 * F-01 deliberately ships no UI: it answers every read and write with a typed
 * status instead of throwing, precisely so this slice can say *which* problem
 * occurred. The six cases below mean genuinely different things and imply
 * different actions, and collapsing them into "coś poszło nie tak" would throw
 * away the whole reason the contract is a discriminated union.
 */

/**
 * Everything the GM has to be told about, in the vocabulary of the thing that
 * happened rather than of the call that failed.
 *
 * `read-only` and `not-found` are deliberately absent. Both are consequences of
 * a condition already on screen — the read-only latch is engaged *by*
 * `future-version` or `unreadable`, and a missing transient record means the
 * auto-persist failed earlier and raised its own notice then. Naming the
 * consequence would replace the reason with its symptom.
 */
export type StorageCondition =
  | "unavailable"
  | "quota-exceeded"
  | "future-version"
  | "quarantined"
  | "unreadable"
  | "superseded";

/**
 * The copy, in Polish, one entry per condition.
 *
 * Two distinctions are doing real work and must survive any edit:
 *
 * - `quarantined` says the data was **set aside**; `unreadable` says it was
 *   **left in place**. F-01 separates them because the second is the
 *   full-store-plus-corruption case where the copy aside failed, and nothing
 *   was moved. Telling a GM their data was set aside when it was not sends
 *   them looking in the wrong place.
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
  quarantined:
    "Nie udało się odczytać zapisanych danych. Zostały odłożone na bok, a nie skasowane — nadal są w pamięci przeglądarki.",
  unreadable:
    "Nie udało się odczytać zapisanych danych ani odłożyć ich na bok, więc nic nie zostało zmienione. Dane wciąż tam są — zwolnij miejsce w pamięci przeglądarki, żeby spróbować je odzyskać.",
  superseded:
    "Inna karta zapisała innego kupca i to on jest teraz na ekranie. Ręczne korekty z tej karty zostały zastąpione.",
};

interface Props {
  /** `null` when there is nothing wrong — the ordinary case. */
  condition: StorageCondition | null;
}

/**
 * Persistent, not a toast: a GM who looks away and misses it loses the session.
 *
 * Kept to one compact paragraph so it does not push the table below the fold on
 * a 360 px phone, which is where this product is actually used.
 *
 * `role="status"` rather than `alert`: every one of these arrives after a page
 * load or a background event, and none of them interrupts what the GM is doing
 * — generating and editing keep working in all six.
 */
export default function StorageNotice({ condition }: Props) {
  if (condition === null) {
    return null;
  }

  return (
    <p role="status" className="mt-4 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
      {MESSAGES[condition]}
    </p>
  );
}
