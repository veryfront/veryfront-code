// Deliberately does NOT import `#veryfront/schemas/_test-setup.ts`. That import
// (and the identical `deno test --preload=src/testing/preload.ts`) is what hid
// this bug: it registers a SchemaValidator that no proxy process ever
// registers, so every in-process suite verified dispatch signatures against a
// registry the proxy does not have. The clean-process case below is therefore
// a child `deno run` that inherits neither.

import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { register, tryResolve, unregister } from "veryfront/extensions/contracts";
import { runStandaloneProxyRuntime } from "./proxy-runtime.ts";

// Kept in sync by hand with the fixture's own constant. The fixture is never
// imported here: its module body *is* the scenario, so importing it would run
// the proxy bootstrap inside the test process and defeat the whole point.
const FIXTURE_RESULT_PREFIX = "__RESULT__";

const FIXTURE_URL = new URL(
  "./_routing-invalidation-bootstrap-fixture.ts",
  import.meta.url,
);
const REPOSITORY_ROOT_URL = new URL("../../../", import.meta.url);

function readFixtureResult(stdout: string): Record<string, unknown> {
  const line = stdout.split("\n").find((entry) => entry.startsWith(FIXTURE_RESULT_PREFIX));
  if (line === undefined) {
    throw new Error(`Fixture produced no result line:\n${stdout}`);
  }
  return JSON.parse(line.slice(FIXTURE_RESULT_PREFIX.length)) as Record<string, unknown>;
}

describe("standalone proxy runtime schema contracts", () => {
  it("registers a SchemaValidator before the proxy runtime is imported", async () => {
    // Dispatch-signature verification parses its claims through a
    // SchemaValidator-backed schema. Without one the proxy cannot verify any
    // control-plane signature, so the contract must be satisfied by the time
    // the proxy runtime — and its request router — exists.
    const previous = tryResolve<unknown>("SchemaValidator");
    unregister("SchemaValidator");
    let registeredAtProxyLoad: unknown;
    try {
      await runStandaloneProxyRuntime({}, {
        activateExtensions: () => Promise.resolve(null),
        registerTeardown: () => Promise.resolve(() => Promise.resolve()),
        loadProxy: () => {
          registeredAtProxyLoad = tryResolve<unknown>("SchemaValidator");
          return Promise.resolve();
        },
        keepAlive: () => Promise.resolve(),
      });
    } finally {
      if (previous !== undefined) register("SchemaValidator", previous);
    }

    assertEquals(registeredAtProxyLoad !== undefined, true);
  });

  it("accepts a signed deployment routing invalidation in a clean proxy process", async () => {
    const command = new Deno.Command(Deno.execPath(), {
      args: ["run", "--no-check", "--allow-all", FIXTURE_URL.href],
      cwd: REPOSITORY_ROOT_URL,
      stdout: "piped",
      stderr: "piped",
    });
    const output = await command.output();
    const stdout = new TextDecoder().decode(output.stdout);
    const stderr = new TextDecoder().decode(output.stderr);
    assertEquals(output.success, true, stderr);

    const result = readFixtureResult(stdout);
    assertEquals(result.status, 200, JSON.stringify(result));
    assertEquals(result.body, { acknowledged: 2, converged: true, recipients: 2 });
    assertEquals(result.schemaValidatorRegistered, true);
  });
});
