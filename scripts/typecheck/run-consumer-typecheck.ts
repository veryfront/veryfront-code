/**
 * Consumer `tsc --noEmit` gate.
 *
 * Typechecks {@link ./fixtures} — documented UI, chat, and trigger composition
 * — against the BUILT npm package (`npm/esm/**.d.ts`) using a real
 * `@types/react`, exactly the way an external app compiles the published
 * declarations. This is the gap `deno check` (Deno's own react types + source)
 * and a source-level `tsc` both leave open: it is what caught, and now guards
 * against, the dnt react-shim regression that stripped `children`/`className`/
 * event handlers from every `extends React.HTMLAttributes` component's public
 * type. See ./README.md.
 *
 * Preflight:
 *   - Needs the TypeScript compiler from `storybook/node_modules` (the repo's
 *     only `tsc`). Absent → hard error (install storybook deps).
 *   - Rebuilds the npm package so declarations always match the current source.
 *
 * @module scripts/typecheck/run-consumer-typecheck
 */

const REPO_ROOT = new URL("../../", import.meta.url).pathname;
const TSC = `${REPO_ROOT}storybook/node_modules/.bin/tsc`;
const TSCONFIGS = [
  {
    label: "exact optional-property semantics",
    path: "scripts/typecheck/tsconfig.consumer.json",
  },
  {
    label: "default optional-property semantics",
    path: "scripts/typecheck/tsconfig.consumer-default-optional.json",
  },
] as const;
function exists(path: string): boolean {
  try {
    Deno.statSync(path);
    return true;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return false;
    throw error;
  }
}

async function run(cmd: string, args: string[]): Promise<number> {
  const child = new Deno.Command(cmd, {
    args,
    cwd: REPO_ROOT,
    stdout: "inherit",
    stderr: "inherit",
  }).spawn();
  const { code } = await child.status;
  return code;
}

if (!exists(TSC)) {
  console.error(
    `✖ consumer typecheck: TypeScript compiler not found at ${TSC}\n` +
      `  Install the Storybook toolchain first:  npm --prefix storybook ci`,
  );
  Deno.exit(1);
}

if (!Deno.args.includes("--skip-build")) {
  console.log(
    "Rebuilding npm/ from the current source with deno task build:npm.",
  );
  const buildCode = await run("deno", ["task", "build:npm"]);
  if (buildCode !== 0) {
    console.error("✖ consumer typecheck: build:npm failed");
    Deno.exit(buildCode);
  }
}

for (const config of TSCONFIGS) {
  console.log(
    `• consumer typecheck: ${config.label} vs built npm .d.ts`,
  );
  const code = await run(TSC, ["--noEmit", "-p", config.path]);
  if (code !== 0) Deno.exit(code);
}
console.log(
  "✓ consumer typecheck: published composition types are consumer-clean",
);
