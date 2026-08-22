import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { buildDenoTestCommandArgs } from "./coverage-ci.ts";
import { LOOPBACK_ONLY_NET } from "./unit-lane-permissions.ts";

describe("coverage CI command", () => {
  it("limits network access to loopback rather than denying named hosts", () => {
    const args = buildDenoTestCommandArgs({
      coverageDir: "coverage-shard-1",
      files: ["src/provider/model-registry.test.ts"],
    });

    assertEquals(args.includes(LOOPBACK_ONLY_NET), true);
    // `--allow-all` cannot coexist with a narrowed `--allow-net`, and any
    // `--deny-net` would be a provider host list creeping back in.
    assertEquals(args.includes("--allow-all"), false);
    assert(!args.some((arg) => arg.startsWith("--deny-net")));
    // The lane still needs everything else `--allow-all` used to grant.
    for (const flag of ["--allow-read", "--allow-write", "--allow-env", "--allow-run"]) {
      assertEquals(args.includes(flag), true, `${flag} must stay granted`);
    }
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
