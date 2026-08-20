import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { buildDenoTestCommandArgs } from "./coverage-ci.ts";

const providerDenyNet =
  "--deny-net=api.openai.com,api.anthropic.com,generativelanguage.googleapis.com,api.mistral.ai,api.groq.com,api.deepseek.com,openrouter.ai";

describe("coverage CI command", () => {
  it("denies live provider egress while preserving allow-all for local test fixtures", () => {
    const args = buildDenoTestCommandArgs({
      coverageDir: "coverage-shard-1",
      files: ["src/provider/model-registry.test.ts"],
    });

    assert(args.includes("--allow-all"));
    assertEquals(args.includes(providerDenyNet), true);
    assertEquals(
      args.indexOf(providerDenyNet) > args.indexOf("--allow-all"),
      true,
    );
  });
});
