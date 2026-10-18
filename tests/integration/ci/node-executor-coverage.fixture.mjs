import { test } from "node:test";
import { runNativeCoverageGroups } from "../../../scripts/test/coverage-node-executor.mjs";

// The collector merges inherited child V8 ranges before producing one LCOV.
test("collects bounded native executor groups", { timeout: 180_000 }, async () => {
  await runNativeCoverageGroups();
});
