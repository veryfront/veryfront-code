import { assertEquals } from "#std/assert";
import { describe, it } from "#std/testing/bdd";
import { findForbiddenTrackedDocs } from "./validate-tracked-docs.ts";

describe("tracked docs validation", () => {
  it("flags internal working notes and completed superpowers artifacts", () => {
    assertEquals(
      findForbiddenTrackedDocs([
        "docs/superpowers/specs/completed-design.md",
        "docs/internal/rollout.md",
        "docs/superpowers/plans/completed-plan.md",
      ]),
      [
        "docs/internal/rollout.md",
        "docs/superpowers/plans/completed-plan.md",
        "docs/superpowers/specs/completed-design.md",
      ],
    );
  });

  it("normalizes platform separators and keeps durable docs", () => {
    assertEquals(
      findForbiddenTrackedDocs([
        "docs\\internal\\temporary.md",
        "docs/architecture/current-state.md",
        "docs/evidence/reproducible.json",
        "docs/rfcs/proposal.md",
      ]),
      ["docs/internal/temporary.md"],
    );
  });
});
