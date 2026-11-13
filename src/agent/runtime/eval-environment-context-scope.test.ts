import { assertEquals } from "#veryfront/testing/assert.ts";
import { it } from "#veryfront/testing/bdd.ts";
import {
  readEvalEnvironmentContext,
  runWithEvalEnvironmentContext,
} from "./eval-environment-context-scope.ts";

it("scopes an eval environment context to its target agent and the eval call", async () => {
  const seen = await runWithEvalEnvironmentContext(
    "assistant",
    "selected node: Header",
    () =>
      Promise.resolve([
        readEvalEnvironmentContext("assistant"),
        // A delegated child agent runs inside the same call but is not the eval target.
        readEvalEnvironmentContext("child"),
      ]),
  );

  assertEquals(seen, ["selected node: Header", undefined]);
  assertEquals(readEvalEnvironmentContext("assistant"), undefined);
});
