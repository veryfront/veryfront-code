/**
 * Scaffold export contract.
 *
 * `veryfront/scaffold` is the whole point of the parity work: a service that
 * creates projects on a user's behalf calls `materializeScaffold()` instead of
 * keeping its own copy of a starter. That only holds while the subpath is
 * actually declared, and a declared export with nothing asserting it is how
 * the coupling breaks silently — a directory move in this repository is enough
 * to drop the entry, and every in-repo test keeps passing because they all
 * import through relative paths that moved with it.
 *
 * These tests are that missing enforcement, and they live in the repository
 * where a layout change originates. The clean-room half — that the subpath
 * resolves from an installed package, through the published `exports` map —
 * is step 6 of `scripts/test/npm-install-smoke.sh`; nothing that imports by
 * relative path can prove it.
 *
 * @module templates/scaffold-export.test
 */

import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { readTextFile, stat } from "#veryfront/testing/deno-compat.ts";
import * as scaffold from "./scaffold.ts";

/** The public subpath. Changing it is a breaking change for every consumer. */
const EXPORT_SUBPATH = "./scaffold";
const EXPORT_SOURCE = "./templates/scaffold.ts";

/**
 * The behaviour a consumer outside this repository calls. `materializeScaffold`
 * is the reason the subpath exists; the other three are what a caller needs to
 * accept a template name from a user before calling it.
 */
const REQUIRED_EXPORTS = [
  "materializeScaffold",
  "listScaffoldTemplates",
  "resolveScaffoldTemplate",
  "SCAFFOLD_TEMPLATE_ALIASES",
] as const;

async function readDenoExports(): Promise<Record<string, string>> {
  return JSON.parse(await readTextFile("deno.json")).exports;
}

describe("scaffold export", () => {
  it("is a declared public subpath", async () => {
    const exports = await readDenoExports();

    assertEquals(
      exports[EXPORT_SUBPATH],
      EXPORT_SOURCE,
      `${EXPORT_SUBPATH} must be exported from ${EXPORT_SOURCE}`,
    );
  });

  /**
   * `deno task build:npm` turns every `exports` entry straight into a dnt entry
   * point, so an entry pointing at a file that no longer exists fails the build
   * rather than the test suite. Catch it here, where the message says which
   * subpath moved.
   */
  it("points at a module that exists", async () => {
    const exports = await readDenoExports();
    const source = exports[EXPORT_SUBPATH];
    assert(source !== undefined, `${EXPORT_SUBPATH} is not exported`);

    const info = await stat(source.replace(/^\.\//, ""));
    assert(info.isFile, `${source} is not a file`);
  });

  it("carries the behaviour a consumer imports it for", () => {
    for (const name of REQUIRED_EXPORTS) {
      assert(
        name in scaffold,
        `veryfront/scaffold no longer exports "${name}"`,
      );
    }

    assertEquals(typeof scaffold.materializeScaffold, "function");
    assertEquals(typeof scaffold.listScaffoldTemplates, "function");
    assertEquals(typeof scaffold.resolveScaffoldTemplate, "function");
  });

  it("materializes a project through the exported entry point", async () => {
    const { files } = await scaffold.materializeScaffold({
      template: "minimal",
      projectName: "export-contract-app",
    });

    const paths = files.map((file) => file.path);
    for (const expected of ["package.json", "AGENTS.md", ".gitignore"]) {
      assert(
        paths.includes(expected),
        `a materialized project is missing ${expected}`,
      );
    }

    const { files: denoFiles } = await scaffold.materializeScaffold({
      template: "minimal",
      projectName: "export-contract-app",
      runtime: "deno",
    });

    assert(
      denoFiles.some((file) => file.path === "deno.json"),
      "a Deno-runtime project is missing deno.json",
    );
  });
});
