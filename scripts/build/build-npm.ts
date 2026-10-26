import {
  isCiNpmBuild,
  NpmDocsBuildContext,
  npmDocsBuildContext,
} from "./npm-docs-build-context.ts";

interface NpmBuildOptions {
  root?: string;
  release?: boolean;
  context?: NpmDocsBuildContext;
  run?: (args: string[], root: string) => Promise<void>;
  transform?: () => Promise<unknown>;
}

async function run(args: string[], root: string) {
  const result = await new Deno.Command(Deno.execPath(), {
    args,
    cwd: root,
    stdout: "inherit",
    stderr: "inherit",
  }).output();
  if (!result.success) throw new Error("Npm build preparation failed");
}

/** Capture release provenance before any task can rewrite tracked generator output. */
export async function buildNpm(options: NpmBuildOptions = {}) {
  if (
    options.context && options.context !== npmDocsBuildContext &&
    !options.transform
  ) {
    throw new Error(
      "A custom npm build context requires an explicit transformer",
    );
  }
  const root = options.root ?? Deno.cwd();
  if (
    !options.transform &&
    await Deno.realPath(root) !== await Deno.realPath(Deno.cwd())
  ) {
    throw new Error("Run the npm build from its source checkout");
  }
  const manifest: { version?: unknown } = JSON.parse(
    await Deno.readTextFile(`${root}/deno.json`),
  );
  const context = options.context ?? npmDocsBuildContext;
  if (typeof manifest.version !== "string" || !manifest.version) {
    throw new Error("Npm build requires a source version");
  }
  await context.capture(
    root,
    manifest.version,
    options.release ?? isCiNpmBuild(),
  );
  const execute = options.run ?? run;
  await execute(
    ["run", "-A", "scripts/build/generate-integrations-module.ts"],
    root,
  );
  await execute(["task", "generate"], root);
  await execute(["task", "lint:dnt-meta-properties"], root);
  await context.sealGeneratedOutputs();
  await (options.transform ?? (() => import("./build-npm-dnt.ts")))();
  await context.assertStable();
}

if (import.meta.main) await buildNpm();
