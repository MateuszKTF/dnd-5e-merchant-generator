import { Component, type ErrorInfo, type ReactNode } from "react";

import MerchantGenerator from "@/components/MerchantGenerator";

interface BoundaryProps {
  readonly children: ReactNode;
}

interface BoundaryState {
  readonly failed: boolean;
}

/**
 * Last line of defence for the single product route.
 *
 * `MerchantGenerator` already wraps the draw in try/catch, but that only covers
 * the click handler. A throw during *render* — a reshaped `AssortmentRow`, a
 * catalog regeneration that leaves a price non-numeric — unmounts the island
 * instead, and there is no server and no second route to fall back to: the GM
 * would be left staring at an empty page.
 *
 * The repo's only class component. React has no hook equivalent for this.
 */
class ErrorBoundary extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { failed: false };

  static getDerivedStateFromError(): BoundaryState {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Nothing is persisted about the crash and there is no logging sink, so the
    // console is the only place the stack survives at all.
    // eslint-disable-next-line no-console
    console.error("Generator crashed during render:", error, info.componentStack);
  }

  render(): ReactNode {
    if (!this.state.failed) return this.props.children;

    return (
      <section role="alert" className="mx-auto w-full max-w-3xl px-4 py-8">
        <h1 className="text-xl font-semibold">Generator przestał odpowiadać</h1>
        <p className="mt-2 text-sm">
          Coś zepsuło się przy wyświetlaniu asortymentu. Odśwież stronę — zapisani kupcy zostają w pamięci przeglądarki
          i nic nie przepadło.
        </p>
        <button
          type="button"
          className="mt-4 h-11 rounded-md border px-4"
          onClick={() => {
            window.location.reload();
          }}
        >
          Odśwież stronę
        </button>
      </section>
    );
  }
}

/**
 * What the route mounts.
 *
 * The boundary has to wrap the generator *inside* React — passing it through an
 * Astro slot would server-render it as a sibling island and the boundary would
 * never see its errors.
 */
export default function GeneratorIsland() {
  return (
    <ErrorBoundary>
      <MerchantGenerator />
    </ErrorBoundary>
  );
}
