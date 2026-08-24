/**
 * Cross-file regression for BDD environment isolation.
 *
 * The child test process keeps both fixture files together even when the parent
 * test suite distributes its own files across coverage shards.
 *
 * @module testing/env-exclusion-test
 */

import { fromFileUrl } from "#veryfront/compat/path";
import { assert, assertStringIncludes } from "./assert.ts";
import { describe, it } from "./bdd.ts";

const PROJECT_ROOT = fromFileUrl(new URL("../../", import.meta.url));
const FIXTURES = [
  fromFileUrl(new URL("./env-exclusion-a.fixture.ts", import.meta.url)),
  fromFileUrl(new URL("./env-exclusion-b.fixture.ts", import.meta.url)),
];

describe("testing/BDD cross-file environment isolation", () => {
  it("keeps module and suite environment values inside each test file", async () => {
    const output = await new Deno.Command(Deno.execPath(), {
      args: [
        "test",
        "--preload=src/testing/preload.ts",
        "--no-check",
        "--allow-all",
        "--parallel",
        ...FIXTURES,
      ],
      cwd: PROJECT_ROOT,
      stdout: "piped",
      stderr: "piped",
    }).output();

    const stdout = new TextDecoder().decode(output.stdout);
    const stderr = new TextDecoder().decode(output.stderr);
    assert(output.success, `Cross-file environment probe failed:\n${stdout}${stderr}`);
    assertStringIncludes(
      stdout,
      "4 passed (4 steps)",
      `both env-isolation probe files must actually register and run their two tests each:\n${stdout}${stderr}`,
    );
    assertStringIncludes(
      stdout,
      "0 failed",
      `no env-isolation probe case may be skipped or fail:\n${stdout}${stderr}`,
    );
  });
});
