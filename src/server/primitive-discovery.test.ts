import { assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { DiscoveryResult } from "#veryfront/discovery";
import { assertPrimitiveDiscoverySucceeded } from "./primitive-discovery.ts";

function resultWithErrors(errors: DiscoveryResult["errors"]): DiscoveryResult {
  return {
    tools: new Map(),
    agents: new Map(),
    skills: new Map(),
    resources: new Map(),
    prompts: new Map(),
    workflows: new Map(),
    tasks: new Map(),
    schedules: new Map(),
    webhooks: new Map(),
    evals: new Map(),
    errors,
  };
}

describe("assertPrimitiveDiscoverySucceeded", () => {
  it("accepts a complete discovery generation", () => {
    assertPrimitiveDiscoverySucceeded(resultWithErrors([]));
  });

  it("rejects a generation containing definition failures", () => {
    assertThrows(
      () => {
        assertPrimitiveDiscoverySucceeded(
          resultWithErrors([{
            file: "agents/broken.ts",
            error: new Error("invalid export"),
          }]),
        );
      },
      Error,
      "Primitive discovery failed for 1 definition",
    );
  });
});
