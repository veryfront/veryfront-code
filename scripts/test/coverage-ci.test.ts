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

  it("keeps the merge task loadable with npm disabled", async () => {
    const output = await new Deno.Command(Deno.execPath(), {
      args: ["task", "coverage:ci:merge"],
      stdout: "piped",
      stderr: "piped",
    }).output();
    const stderr = new TextDecoder().decode(output.stderr);

    assertEquals(output.success, false);
    assert(stderr.includes("At least one LCOV file or directory is required."));
    assertEquals(stderr.includes("npm specifiers were requested"), false);
  });
});

describe("buildDenoTestCommandArgs leak tracing", () => {
  it("traces leaks, so the first failure names the source", () => {
    // These leaks are load-dependent and do not reproduce on demand. Without
    // the flag the run reports only "run again with --trace-leaks", advice that
    // cannot be taken for a failure that will not recur.
    assert(
      buildDenoTestCommandArgs({ coverageDir: "cov", files: ["a.test.ts"] })
        .includes("--trace-leaks"),
    );
  });
});
