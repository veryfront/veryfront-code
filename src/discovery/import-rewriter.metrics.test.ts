import "#veryfront/schemas/_test-setup.ts";
import { assert } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { DISCOVERY_GLOBAL_VERYFRONT_MODULES } from "./import-rewriter.ts";

describe("discovery import rewriter metrics module", () => {
  it("makes veryfront/metrics available to project-authored modules", () => {
    assert(
      DISCOVERY_GLOBAL_VERYFRONT_MODULES.includes("veryfront/metrics"),
      "veryfront/metrics should be available to discovered project modules",
    );
  });

  it("makes veryfront/knowledge available to project-authored modules", () => {
    assert(
      DISCOVERY_GLOBAL_VERYFRONT_MODULES.includes("veryfront/knowledge"),
      "veryfront/knowledge should be available to discovered project modules",
    );
  });

  it("includes every source-discovered primitive definition module", () => {
    for (
      const specifier of [
        "veryfront/schedule",
        "veryfront/task",
        "veryfront/trigger",
        "veryfront/webhook",
      ] as const
    ) {
      assert(
        DISCOVERY_GLOBAL_VERYFRONT_MODULES.includes(specifier),
        `${specifier} should be available to discovered project modules`,
      );
    }
  });
});
