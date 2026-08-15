import { getConfig } from "veryfront/config";
import { cliLogger } from "#cli/utils";
import { createError, toError } from "veryfront/errors";
import { exists, join, readTextFile } from "veryfront/fs";
import { generateIntegration } from "./integration-generator.ts";
import { isScaffoldType, scaffoldProjectFile } from "../../scaffold/engine.ts";

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

function stripProjectJsoncComments(source: string): string {
  let output = "";
  let inString = false;
  let escaped = false;

  for (let index = 0; index < source.length; index++) {
    const char = source[index]!;
    if (inString) {
      output += char;
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      output += char;
      continue;
    }
    if (char === "/" && source[index + 1] === "/") {
      output += "  ";
      index += 2;
      while (index < source.length && !/[\r\n\u2028\u2029]/.test(source[index]!)) {
        output += " ";
        index++;
      }
      if (index < source.length) output += source[index]!;
      continue;
    }
    if (char === "/" && source[index + 1] === "*") {
      output += "  ";
      index += 2;
      while (index < source.length) {
        if (source[index] === "*" && source[index + 1] === "/") {
          output += "  ";
          index++;
          break;
        }
        output += /[\r\n\u2028\u2029]/.test(source[index]!) ? source[index]! : " ";
        index++;
      }
      continue;
    }
    output += char;
  }

  return output;
}

function stripProjectJsoncTrailingCommas(source: string): string {
  let output = "";
  let inString = false;
  let escaped = false;

  for (let index = 0; index < source.length; index++) {
    const char = source[index]!;
    if (inString) {
      output += char;
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      output += char;
      continue;
    }
    if (char === ",") {
      let next = index + 1;
      while (/\s/.test(source[next] ?? "")) next++;
      output += source[next] === "}" || source[next] === "]" ? " " : ",";
      continue;
    }
    output += char;
  }

  return output;
}

function parseProjectManifest(source: string, syntax: "json" | "jsonc"): {
  dependencies?: Record<string, unknown>;
  devDependencies?: Record<string, unknown>;
  imports?: Record<string, unknown>;
} {
  const json = syntax === "jsonc"
    ? stripProjectJsoncTrailingCommas(stripProjectJsoncComments(source))
    : source;
  return JSON.parse(json);
}

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
      const parsed = parseProjectManifest(await readTextFile(path), manifest.syntax);
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
