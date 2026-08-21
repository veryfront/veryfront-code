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
 *
 * `generate` runs through the run-generate.ts orchestrator, so the
 * generate-side script list comes from its UNITS table rather than from
 * parsing the task string; the check side is still parsed out of the task
 * chain, so a unit added without a `--check` counterpart still fails here.
 */

import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { fromFileUrl, join } from "#std/path";
import { UNITS } from "./run-generate.ts";

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

const generators = new Map<string, boolean>();
for (const unit of UNITS) {
  for (const argv of unit.commands) {
    const script = argv.find((arg) => arg.endsWith(".ts"));
    if (script !== undefined) generators.set(script, argv.includes("--check"));
  }
}
const checks = scriptInvocations(expandTask("generate:manifests:check"));

async function runTemplateManifestGenerator(
  root: string,
  args: string[],
): Promise<Deno.CommandOutput> {
  return await new Deno.Command(Deno.execPath(), {
    args: [
      "run",
      "-A",
      `--config=${fromFileUrl(new URL("../test.deno.json", import.meta.url))}`,
      fromFileUrl(new URL("./generate-templates-manifest.ts", import.meta.url)),
      ...args,
      "--root",
      root,
    ],
    stdout: "piped",
    stderr: "piped",
  }).output();
}

async function createTemplateManifestFixture(): Promise<string> {
  const root = await Deno.makeTempDir({
    prefix: "veryfront-template-manifest-",
  });
  for (
    const path of [
      "templates/files/example",
      "templates/integrations",
      "templates/features",
      "templates/ai-rules",
    ]
  ) {
    await Deno.mkdir(join(root, path), { recursive: true });
  }
  await Deno.writeTextFile(
    join(root, "templates/files/example/index.ts"),
    "export const example = true;\n",
  );

  const generated = await runTemplateManifestGenerator(root, []);
  assertEquals(
    generated.code,
    0,
    new TextDecoder().decode(generated.stderr),
  );
  return root;
}

function changeGzipOsByte(source: string): string {
  const encoded = source.match(/"([A-Za-z0-9+/=]+)"/)?.[1];
  assert(
    encoded !== undefined,
    "generated manifest must contain base64 gzip data",
  );
  const binary = atob(encoded);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  assert(bytes.length > 9, "generated manifest must contain a gzip header");
  bytes[9] = bytes[9] === 3 ? 255 : 3;
  const changed = btoa(String.fromCharCode(...bytes));
  return source.replace(encoded, changed);
}

describe("generated artifact checks", () => {
  it("runs before source typechecking", () => {
    assertStringIncludes(
      String(tasks.typecheck),
      "deno task generate:manifests:check && deno check",
      "typecheck must fail on stale generated artifacts before source checking starts",
    );
  });

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

  it("checks compressed manifest content without rewriting its encoding", async () => {
    const root = await createTemplateManifestFixture();
    const path = join(root, "templates/manifest.generated.ts");
    try {
      const original = await Deno.readTextFile(path);
      const equivalent = changeGzipOsByte(original);
      await Deno.writeTextFile(path, equivalent);

      const equivalentResult = await runTemplateManifestGenerator(root, [
        "--check",
      ]);
      assertEquals(
        equivalentResult.code,
        0,
        new TextDecoder().decode(equivalentResult.stderr),
      );
      assertEquals(
        await Deno.readTextFile(path),
        equivalent,
        "the freshness check must not normalize equivalent gzip bytes",
      );

      const drifted = equivalent.replace(
        "COMPRESSED_TEMPLATE_MANIFEST_BASE64",
        "DRIFTED_TEMPLATE_MANIFEST_BASE64",
      );
      assert(
        drifted !== equivalent,
        "test fixture must invalidate the generated manifest",
      );
      await Deno.writeTextFile(path, drifted);

      const result = await runTemplateManifestGenerator(root, ["--check"]);

      assert(result.code !== 0, "manifest drift must fail the freshness check");
      const stderr = new TextDecoder().decode(result.stderr);
      assertStringIncludes(stderr, "templates/manifest.generated.ts is stale");
      assertEquals(
        await Deno.readTextFile(path),
        drifted,
        "the freshness check must not rewrite the committed manifest",
      );
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  });
});
