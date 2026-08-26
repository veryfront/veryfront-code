import { getConfig } from "veryfront/config";
import { cliLogger } from "#cli/utils";
import { ALREADY_EXISTS, CONFIG_INVALID, createError, toError } from "veryfront/errors";
import { parseExtensionManifest } from "veryfront/extensions";
import { exists, join, readTextFile } from "veryfront/fs";
import { generateIntegration } from "./integration-generator.ts";
import {
  isAuthPreset,
  isScaffoldType,
  scaffoldAuthFiles,
  scaffoldProjectFile,
  type ScaffoldResult,
} from "../../scaffold/engine.ts";

const MDX_EXTENSION_PACKAGE = "@veryfront/ext-content-mdx";

const PROJECT_MARKERS = [
  "veryfront.config.ts",
  "veryfront.config.js",
  "veryfront.config.mjs",
  // Legacy, but still read and merged by the CLI config loader, so a project
  // identified only by this file is a real project. `veryfront.config.json` is
  // deliberately absent — the loader does not recognise that name.
  "veryfront.json",
] as const;

// Deno accepts JSONC grammar for `deno.json` as well as `deno.jsonc`, matching
// `src/extensions/discovery.ts`. Parsing those with strict JSON makes a
// commented manifest look like no evidence at all and fires a false warning.
const PROJECT_MANIFESTS = [
  { name: "package.json", syntax: "json" },
  { name: "deno.json", syntax: "jsonc" },
  { name: "deno.jsonc", syntax: "jsonc" },
] as const;

/**
 * `generate` writes into whatever directory it is invoked from, so running it
 * one level above the project (or in the wrong terminal tab) silently produces
 * a stray `app/` tree. `dev` already warns in this situation; match it rather
 * than failing, so scaffolding into a not-yet-configured directory still works.
 */
async function looksLikeVeryfrontProject(projectDir: string): Promise<boolean> {
  for (const marker of PROJECT_MARKERS) {
    if (await exists(join(projectDir, marker))) return true;
  }

  for (const manifest of PROJECT_MANIFESTS) {
    const path = join(projectDir, manifest.name);
    if (!(await exists(path))) continue;
    try {
      const parsed = parseExtensionManifest<{
        dependencies?: Record<string, unknown>;
        devDependencies?: Record<string, unknown>;
        imports?: Record<string, unknown>;
      }>(await readTextFile(path), manifest.syntax, manifest.name);
      const specifiers = [
        ...Object.keys(parsed.dependencies ?? {}),
        ...Object.keys(parsed.devDependencies ?? {}),
        ...Object.keys(parsed.imports ?? {}),
      ];
      if (
        specifiers.some((s) => s === "veryfront" || s.startsWith("veryfront/"))
      ) {
        return true;
      }
    } catch {
      // An unparseable manifest is not evidence either way; keep looking.
    }
  }

  return false;
}

async function warnIfOutsideProject(projectDir: string): Promise<void> {
  if (await looksLikeVeryfrontProject(projectDir)) return;
  // Deliberately no path: `projectDir` is an absolute machine path, which
  // AGENTS.md forbids in user-facing output. The directory is where the user
  // already is, so naming it adds nothing they cannot see.
  cliLogger.warn(
    `The current directory does not look like a Veryfront project; scaffolding here anyway. ` +
      `Run this from your project root, or create one with "npm create veryfront".`,
  );
}

export async function getPreferredRouter(
  projectDir: string,
): Promise<"pages-router" | "app-router"> {
  try {
    const { runtime } = await import("veryfront/platform");
    const adapter = await runtime.get();
    const cfg = await getConfig(projectDir, adapter);
    const pref = cfg?.generate?.preferredRouter ?? cfg?.router;
    if (pref === "app-router" || pref === "app") return "app-router";
    if (pref === "pages-router" || pref === "pages") return "pages-router";
  } catch {
    cliLogger.debug("Could not load config for generate command, using defaults");
  }
  return "app-router";
}

export async function generateCommand(
  projectDir: string,
  type: string,
  name: string,
): Promise<void> {
  await warnIfOutsideProject(projectDir);

  if (type === "integration") {
    await generateIntegration(projectDir, { name: name || undefined });
    return;
  }

  if (type === "auth") {
    if (!isAuthPreset(name)) {
      throw toError(
        createError({
          type: "config",
          message: `Unknown auth preset: ${name}. Valid presets: authelia, oidc, microsoft-entra`,
        }),
      );
    }

    const result = await scaffoldAuthFiles({
      projectDir,
      preset: name,
    });

    if (!result.success) {
      throw scaffoldFailureToError(result);
    }

    for (const file of result.files) cliLogger.info(`Created ${file.path}`);
    return;
  }

  const preferred = await getPreferredRouter(projectDir);

  if (!isScaffoldType(type)) {
    throw toError(
      createError({
        type: "config",
        message: `Unknown generate type: ${type}`,
      }),
    );
  }

  const result = await scaffoldProjectFile({
    projectDir,
    type,
    name,
    router: preferred,
  });

  if (!result.success) {
    throw scaffoldFailureToError(result);
  }

  for (const file of result.files) cliLogger.info(`Created ${file.path}`);
  await warnIfMdxExtensionMissing(projectDir, result.files.map((file) => file.path));
}

export function scaffoldFailureToError(result: ScaffoldResult): Error {
  if (result.failureKind === "conflict") {
    return ALREADY_EXISTS.create({
      detail: result.message,
      context: { paths: result.files.map((file) => file.path) },
    });
  }

  if (result.failureKind === "filesystem") {
    return toError(createError({
      type: "file",
      message: result.message,
      context: { operation: "write" },
    }));
  }

  return CONFIG_INVALID.create({ detail: result.message });
}

/**
 * Tell the user to install the MDX extension when we have just written an
 * `.mdx` file into a project that does not declare it.
 *
 * The pages router scaffolds `.mdx` for `page` and `layout`. Since
 * `@veryfront/ext-content-mdx` became an optional peer of the npm package, a
 * project that never installed it renders those routes as an error — while
 * this command has just reported "Created" and exited 0. The compile path
 * already throws a typed error naming the package, but by then the developer
 * is debugging a route they were told was fine.
 *
 * Best-effort: a project without a readable package.json (a Deno project, say)
 * gets no warning rather than a false one.
 */
async function warnIfMdxExtensionMissing(
  projectDir: string,
  paths: string[],
): Promise<void> {
  if (!paths.some((path) => path.endsWith(".mdx"))) return;
  try {
    const raw = await readTextFile(join(projectDir, "package.json"));
    const manifest = JSON.parse(raw) as Record<string, Record<string, string> | undefined>;
    const declared = [
      manifest.dependencies,
      manifest.devDependencies,
      manifest.peerDependencies,
      manifest.optionalDependencies,
    ].some((group) => group?.[MDX_EXTENSION_PACKAGE] !== undefined);
    if (declared) return;
    // Lockfile-aware: hard-coding `npm install` in a pnpm/yarn/bun project
    // writes a competing package-lock.json and leaves the real lockfile stale.
    const { detectProjectInstallTarget, formatInstallCommand } = await import(
      "veryfront/extensions"
    );
    const install = formatInstallCommand(
      MDX_EXTENSION_PACKAGE,
      detectProjectInstallTarget(projectDir),
    );
    cliLogger.warn(
      `This project does not depend on ${MDX_EXTENSION_PACKAGE}, so the generated .mdx file will not render. Install it with: ${install}`,
    );
  } catch {
    // No readable package.json: say nothing rather than warn wrongly.
  }
}
