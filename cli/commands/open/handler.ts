import type { ParsedArgs } from "#cli/shared/types";
import { parseArgsOrThrow } from "#cli/shared/args";
import { cliLogger, exitProcess } from "#cli/utils";
import { createSuccessEnvelope, isJsonMode, outputJson } from "../../shared/json-output.ts";
import { buildUrl, parseOpenArgs } from "./command.ts";

export async function handleOpenCommand(args: ParsedArgs): Promise<void> {
  const opts = parseArgsOrThrow(parseOpenArgs, "open", args);

  let projectSlug = opts.projectSlug;
  if (!projectSlug) {
    const { cwd } = await import("veryfront/platform");
    const { getEnvironmentConfig } = await import("veryfront/config");
    const { readConfigFile } = await import("#cli/shared/config");
    projectSlug = getEnvironmentConfig().projectSlug
      ?? (await readConfigFile(cwd()))?.projectSlug
      ?? undefined;
  }

  if (!projectSlug) {
    cliLogger.error(
      "No project found. Run from a project directory or use --project-slug",
    );
    exitProcess(1);
  }

  const url = buildUrl(projectSlug, opts);

  if (isJsonMode()) {
    await outputJson(createSuccessEnvelope("open", { url }));
    return;
  }

  const { openBrowser } = await import("../../auth/browser.ts");
  await openBrowser(url);
  console.log(`  Opening ${url}`);
}
