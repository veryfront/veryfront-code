/**
 * Contract test for the generated-artifact guard.
 *
 * `generate:manifests:check` runs inside `typecheck`, so it is what stops a
 * stale committed bundle from merging. It only does that for generators it
 * actually invokes: two of them drifted out of the check for long enough that
 * `bridge-bundle.generated.ts` and `rsc-bundles.generated.ts` could go stale
 * silently. Adding a seventh generator and forgetting its `--check` would
 * reopen the same hole, so assert the two task lists agree.
 *
 * This checks the wiring rather than the bundling. Running the generators for
 * real costs an esbuild pass each, and `generate:manifests:check` already
 * proves they work on every PR.
 */

import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";

type Tasks = Record<string, string>;

// Resolved from this module rather than the process cwd — see
// scripts/lint/audit-cwd-relative-test-reads.ts for why a cwd-relative repo
// read from a test is only correct until an unrelated test chdirs beside it.
const denoJson = JSON.parse(
  await Deno.readTextFile(new URL("../../deno.json", import.meta.url)),
) as {
  tasks: Tasks;
};
const tasks = denoJson.tasks;

/** Inline `deno task <name>` references so both chains can be compared whole. */
function expandTask(name: string, seen = new Set<string>()): string {
  if (seen.has(name)) return "";
  seen.add(name);

  const body = tasks[name] ?? "";
  return body.replace(
    /deno task ([\w:-]+)/g,
    (_match, referenced: string) => expandTask(referenced, seen),
  );
}

/** Every script the command runs, paired with whether it was passed --check. */
function scriptInvocations(command: string): Map<string, boolean> {
  const found = new Map<string, boolean>();

  for (const segment of command.split("&&")) {
    const script = segment.match(/([\w./-]+\.ts)/)?.[1];
    if (!script) continue;
    found.set(script, segment.includes("--check"));
  }

  return found;
}

const generators = scriptInvocations(expandTask("generate"));
const checks = scriptInvocations(expandTask("generate:manifests:check"));

describe("generated artifact checks", () => {
  it("runs at least one generator", () => {
    // Guards against a parsing change quietly emptying both sides and making
    // every assertion below vacuous.
    assertEquals(
      generators.size > 0,
      true,
      "no generators parsed out of `generate`",
    );
  });

  it("checks every generator that `generate` runs", () => {
    const unchecked = [...generators.keys()].filter((script) =>
      !checks.has(script)
    ).sort();

    assertEquals(
      unchecked,
      [],
      `these generators have no --check counterpart in generate:manifests:check, ` +
        `so their committed output can go stale without failing CI: ${
          unchecked.join(", ")
        }`,
    );
  });

  it("passes --check to every generator in the check task", () => {
    const missingFlag = [...checks.entries()]
      .filter(([, hasCheckFlag]) => !hasCheckFlag)
      .map(([script]) => script)
      .sort();

    assertEquals(
      missingFlag,
      [],
      `generate:manifests:check runs these without --check, so they would ` +
        `rewrite their output instead of verifying it: ${
          missingFlag.join(", ")
        }`,
    );
  });

  it("does not check a script that `generate` never runs", () => {
    const orphaned = [...checks.keys()].filter((script) =>
      !generators.has(script)
    ).sort();

    assertEquals(
      orphaned,
      [],
      `checked but never generated: ${orphaned.join(", ")}`,
    );
  });
});
