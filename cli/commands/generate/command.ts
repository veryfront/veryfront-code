import { getConfig } from "veryfront/config";
import { cliLogger } from "#cli/utils";
import { createError, toError } from "veryfront/errors";
import { generateIntegration } from "./integration-generator.ts";
import { isScaffoldType, scaffoldProjectFile } from "../../scaffold/engine.ts";

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
