/**
 * New command - Lightning-fast project creation
 */

import { chdir, cwd } from "#veryfront/platform/compat/process.ts";
import { join } from "#veryfront/platform/compat/path/index.ts";
import { createFileSystem } from "#veryfront/platform/compat/fs.ts";
import { z } from "zod";
import { getRuntimeEnv, type RuntimeEnv } from "#veryfront/config/runtime-env.ts";

import { readToken, validateToken } from "../auth/index.ts";
import { canOpenBrowser, openBrowser } from "../auth/browser.ts";
import { exitProcess, isTTY } from "../utils/index.ts";
import { CommonArgs, createArgParser } from "../shared/args.ts";
import { scaffoldProjectFast } from "./new/fast-scaffold.ts";
import { reserveProjectSlug } from "./new/reserve-slug.ts";
import { runNewTui } from "./new-tui.ts";
import {
  brand,
  createTui,
  dim,
  error,
  handleInput,
  interceptConsole,
  success,
} from "../ui/index.ts";
import type { InitTemplate } from "./init/types.ts";
import type { IntegrationName } from "../templates/types.ts";

// ============================================================================
// Types
// ============================================================================

export const NewArgsSchema = z.object({
  template: z.enum(["ai", "app", "blog", "docs", "minimal"]).optional(),
  integrations: z.string().optional(),
  port: z.number().default(3000),
  skipDeploy: z.boolean().default(false),
  open: z.boolean().default(true),
  force: z.boolean().default(false),
});

export type NewOptions = z.infer<typeof NewArgsSchema> & {
  integrationsList?: string[];
};

export const parseNewArgs = createArgParser(NewArgsSchema, {
  template: { keys: ["template", "t"], type: "string" },
  integrations: { keys: ["integrations", "i"], type: "string" },
  port: { keys: ["port", "p"], type: "number" },
  skipDeploy: { keys: ["skip-deploy"], type: "boolean" },
  open: { keys: ["open", "o"], type: "boolean" },
  force: CommonArgs.force,
});

// ============================================================================
// Helpers
// ============================================================================

function randomSuffix(len = 6): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  return Array.from({ length: len }, () => chars[Math.floor(Math.random() * chars.length)]).join(
    "",
  );
}

function parseIntegrations(integrationsStr?: string): IntegrationName[] {
  if (!integrationsStr) return [];
  return integrationsStr
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean) as IntegrationName[];
}

// ============================================================================
// Main Command
// ============================================================================

export async function newCommand(
  name: string,
  options: Partial<NewOptions> = {},
  env: RuntimeEnv = getRuntimeEnv(),
): Promise<void> {
  let {
    template,
    integrations: integrationsStr,
    port = 3000,
    skipDeploy = false,
    open = true,
    force = false,
  } = options;

  let integrations = parseIntegrations(integrationsStr);

  const fs = createFileSystem();

  const token = env.apiToken || (await readToken());
  const userInfo = token ? await validateToken(token) : null;

  if (!template && isTTY()) {
    const result = await runNewTui(name, userInfo?.email);
    if (result.cancelled) {
      exitProcess(0);
      return;
    }
    template = result.template;
    integrations = result.integrations;
  }

  template ??= "ai";

  const projectDir = join(cwd(), name);
  const slug = `${name}-${randomSuffix()}`;

  if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/.test(name)) {
    console.error(error("Invalid project name. Use lowercase letters, numbers, and hyphens."));
    exitProcess(1);
    return;
  }

  try {
    const stat = await fs.stat(projectDir);
    if (stat.isDirectory && !force) {
      console.error(error(`Directory "${name}" exists. Use --force to overwrite.`));
      exitProcess(1);
      return;
    }
  } catch {
    // ok
  }

  if (skipDeploy) {
    console.log();
    console.log(`  Creating ${brand(slug)}...`);
    await fs.mkdir(projectDir, { recursive: true });
    const result = await scaffoldProjectFast(
      projectDir,
      template as InitTemplate,
      slug,
      integrations,
    );
    console.log(`  ${success("●")} Created ${result.filesWritten} files`);
    console.log();
    console.log(dim(`  cd ${name} && deno task cli dev`));
    console.log();
    return;
  }

  if (!token) {
    console.log("\n" + error("  Please log in: ") + dim("deno task cli login") + "\n");
    exitProcess(1);
    return;
  }

  const tui = createTui({ title: "Veryfront", showLogs: true });
  const restore = interceptConsole(tui);

  const localUrl = `http://${name}.lvh.me:${port}`;
  const prodUrl = `https://${slug}.veryfront.com`;

  tui.setInfo({
    Local: dim("○") + " " + brand(localUrl),
    Production: dim("○") + " " + brand(prodUrl),
  });

  tui.setStatus("Creating...", "loading");

  let shouldExit = false;
  let actualSlug = slug;

  try {
    await fs.mkdir(projectDir, { recursive: true });
    await scaffoldProjectFast(projectDir, template as InitTemplate, slug, integrations);

    const reserveResult = await reserveProjectSlug(slug, token);
    actualSlug = reserveResult.slug;

    chdir(projectDir);
    const { devCommand } = await import("./dev.ts");
    const { ready } = await devCommand({ port, projectDir: cwd(), hmr: true });
    await ready;

    if (open && canOpenBrowser()) {
      await openBrowser(localUrl);
    }

    tui.setInfo({
      Local: success("●") + " " + brand(localUrl),
      Production: dim("○") + " " + brand(prodUrl),
    });
    tui.setStatus("Ready", "success");

    await handleInput(tui, {
      onEnter: () => {
        // Continue to deploy
      },
      onExit: () => {
        shouldExit = true;
      },
    });

    if (shouldExit) {
      tui.cleanup();
      exitProcess(0);
      return;
    }

    tui.setStatus("Deploying...", "loading");

    const { pushCommand } = await import("./push.ts");
    await pushCommand({
      projectDir: cwd(),
      branch: "main",
      force: true,
      dryRun: false,
      quiet: true,
    });

    const { deployCommand: deploy } = await import("./deploy.ts");
    await deploy({ branch: "main", env: "production", force: true, dryRun: false, quiet: true });

    tui.setInfo({
      Local: success("●") + " " + brand(localUrl),
      Production: success("●") + " " + brand(`https://${actualSlug}.veryfront.com`),
    });
    tui.setStatus("Deployed", "success");

    await handleInput(tui, {
      onEnter: () => {},
      onExit: () => {},
    });

    tui.cleanup();
    exitProcess(0);
  } catch (error) {
    tui.setStatus(error instanceof Error ? error.message : String(error), "error");
    await new Promise((r) => setTimeout(r, 2000));
    tui.cleanup();
    restore();
    exitProcess(1);
  }
}
