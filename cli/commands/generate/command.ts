import { getConfig } from "veryfront/config";
import { cliLogger } from "#cli/utils";
import { createError, toError } from "veryfront/errors";
import { generateIntegration } from "./integration-generator.ts";
import { isScaffoldType, scaffoldProjectFile } from "../../scaffold/engine.ts";
import { exists, readTextFile } from "#veryfront/compat/fs.ts";
import { join } from "#veryfront/compat/path";

const PROJECT_MARKERS = [
  "veryfront.config.ts",
  "veryfront.config.js",
  "veryfront.config.mjs",
  "veryfront.config.json",
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

  for (const manifest of ["package.json", "deno.json", "deno.jsonc"]) {
    const path = join(projectDir, manifest);
    if (!(await exists(path))) continue;
    try {
      const parsed = JSON.parse(await readTextFile(path)) as {
        dependencies?: Record<string, unknown>;
        devDependencies?: Record<string, unknown>;
        imports?: Record<string, unknown>;
      };
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
  cliLogger.warn(
    `${projectDir} does not look like a Veryfront project; scaffolding here anyway. ` +
      `Run this from your project root, or create one with "npm create veryfront".`,
  );
}

async function getPreferredRouter(
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

  const preferred = await getPreferredRouter(projectDir);

  if (type === "integration") {
    await generateIntegration(projectDir, { name: name || undefined });
    return;
  }

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
    throw toError(
      createError({
        type: "config",
        message: result.message,
      }),
    );
  }

  for (const file of result.files) cliLogger.info(`Created ${file.path}`);
}
