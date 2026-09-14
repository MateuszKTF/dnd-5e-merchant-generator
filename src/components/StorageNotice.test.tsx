import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import StorageNotice from "@/components/StorageNotice";

/**
 * The harness smoke test: proves a React island actually renders under the
 * runner, before any behavioural test depends on it.
 *
 * This is deliberately the first `.test.tsx` in the repo. A harness that has
 * never executed a real assertion is usually subtly wrong — a leaking root
 * config, a missing alias, a JSX transform that silently produced nothing — and
 * every one of those failure modes looks like "the test passed" until something
 * asserts on output.
 *
 * Oracle: the component's reason to exist. A raised condition has to reach the
 * GM as words on screen; a notice that renders nothing is the silent failure the
 * PRD guardrail forbids.
 */
describe("StorageNotice renders under the dom project", () => {
  it("puts a non-empty message on screen for a raised condition", () => {
    render(<StorageNotice conditions={["quota-exceeded"]} />);

    const status = screen.getByRole("status");

    expect(status).toBeInTheDocument();
    expect(status.textContent.trim().length).toBeGreaterThan(0);
  });

  it("renders the live region even with nothing to say, so it is not mounted with its first message", () => {
    // A live region inserted together with its content is the classic case
    // screen readers skip. The region must already be in the DOM before the
    // first message arrives.
    render(<StorageNotice conditions={[]} />);

    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("shows both conditions when two are raised at once", () => {
    render(<StorageNotice conditions={["write-refused", "records-dropped"]} />);

    const status = screen.getByRole("status");

    expect(status.querySelectorAll("p")).toHaveLength(2);
  });
});
