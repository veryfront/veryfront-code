import type { ParsedArgs } from "#cli/shared/types";
import { parseArgsOrThrow } from "#cli/shared/args";
import { exitProcess, logUsageError } from "#cli/utils";
import { brand } from "../../ui/colors.ts";
import {
  createErrorEnvelope,
  createSuccessEnvelope,
  type ErrorEnvelope,
  isJsonMode,
  outputJson,
} from "../../shared/json-output.ts";
import { buildUrl, parseOpenArgs } from "./command.ts";

const PROJECT_NOT_FOUND_HINT =
  "Run from a project directory or set --project / VERYFRONT_PROJECT_SLUG";

/** The one failure `open` can report, in the machine-readable shape. */
export const PROJECT_NOT_FOUND_ERROR: ErrorEnvelope["error"] = {
  code: "PROJECT_NOT_FOUND",
  slug: "project-not-found",
  message: "No project found.",
  context: { suggestion: PROJECT_NOT_FOUND_HINT },
};

/**
 * Environment references that name a project by slug. `VERYFRONT_PROJECT_ID`
 * and `TENANT_PROJECT_ID` name it by ID instead, and `buildUrl` produces
 * `https://veryfront.com/projects/<slug>` — `push` resolves an ID through the
 * API before printing that URL, which `open` cannot do without a token. So an
 * ID-only reference is skipped rather than pasted in as a slug, and resolution
 * keeps walking to the local link `push`/`deploy` wrote for that same project.
 */
const SLUG_ENVIRONMENT_REFERENCE_NAMES: ReadonlySet<string> = new Set([
  "VERYFRONT_PROJECT_SLUG",
  "TENANT_PROJECT_SLUG",
]);

/**
 * The project `open` targets, in the precedence the deploy docs publish:
 * `--project`, then `VERYFRONT_PROJECT_SLUG` or environment configuration,
 * then `veryfront.config.ts`, then legacy `veryfront.json`, then lower-level
 * tenant slug environment references, then the local project link `push` and
 * `deploy` write into the directory.
 */
export async function resolveOpenProjectSlug(
  projectDir: string,
  explicitSlug?: string,
): Promise<string | undefined> {
  if (explicitSlug) return explicitSlug;

  const { getEnvironmentConfig } = await import("veryfront/config");
  const { readConfigFile, resolveEnvironmentProjectReference } = await import("#cli/shared/config");

  const env = getEnvironmentConfig();
  const fileConfig = await readConfigFile(projectDir);
  const environmentReference = resolveEnvironmentProjectReference();
  const referenced = env.projectSlug ?? fileConfig?.projectSlug ??
    (environmentReference && SLUG_ENVIRONMENT_REFERENCE_NAMES.has(environmentReference.name)
      ? environmentReference.reference
      : undefined);
  if (referenced) return referenced;

  const { resolveCliApiUrl } = await import("../../shared/constants.ts");
  const { readProjectLinkForControlPlane } = await import("../../shared/project-link.ts");

  const link = await readProjectLinkForControlPlane(
    projectDir,
    resolveCliApiUrl(env, fileConfig?.apiUrl),
  );
  return link?.projectSlug;
}

/** Report the one failure `open` can hit, honoring `--json`. */
export async function reportProjectNotFound(): Promise<void> {
  if (isJsonMode()) {
    await outputJson(createErrorEnvelope("open", PROJECT_NOT_FOUND_ERROR));
    return;
  }
  logUsageError(PROJECT_NOT_FOUND_ERROR.message, PROJECT_NOT_FOUND_HINT);
}

export async function handleOpenCommand(args: ParsedArgs): Promise<void> {
  const opts = parseArgsOrThrow(parseOpenArgs, "open", args);

  const { cwd } = await import("veryfront/platform");
  const projectSlug = await resolveOpenProjectSlug(cwd(), opts.projectSlug);

  if (!projectSlug) {
    await reportProjectNotFound();
    exitProcess(1);
    return;
  }

  const url = buildUrl(projectSlug, opts);

  if (isJsonMode()) {
    await outputJson(createSuccessEnvelope("open", { url }));
    return;
  }

  const { openBrowser } = await import("../../auth/browser.ts");
  await openBrowser(url);
  console.log("  " + brand("●") + " Opening " + brand(url));
}
