/**
 * New command - Lightning-fast project creation
 */

import { chdir, cwd } from "#veryfront/platform/compat/process.ts";
import { join } from "#veryfront/platform/compat/path/index.ts";
import { createFileSystem } from "#veryfront/platform/compat/fs.ts";
import { z } from "zod";
import {
  type EnvironmentConfig,
  getEnvironmentConfig,
} from "#veryfront/config/environment-config.ts";

import { ensureAuthenticated, readToken, validateToken } from "../../auth/index.ts";
import { canOpenBrowser, openBrowser } from "../../auth/browser.ts";
import { exitProcess, isTTY } from "#cli/utils";
import { CommonArgs, createArgParser } from "#cli/shared/args";
import { scaffoldProjectFast } from "./fast-scaffold.ts";
import { reserveProjectSlug } from "./reserve-slug.ts";
import { runNewTui } from "./tui.ts";
import {
  brand,
  createTui,
  dim,
  error as errorText,
  handleInput,
  interceptConsole,
  success,
} from "#cli/ui";
import type { InitTemplate } from "../init/types.ts";
import type { IntegrationName } from "../../templates/types.ts";

// ============================================================================
// Types
// ============================================================================

export const NewArgsSchema = z.object({
  template: z.enum(["ai", "app", "blog", "docs", "minimal"]).optional(),
  integrations: z.string().optional(),
  port: z.number().default(3000),
  /** Opt-in to cloud deployment (requires authentication) */
  deploy: z.boolean().default(false),
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
  deploy: { keys: ["deploy", "d"], type: "boolean" },
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

function isValidProjectName(name: string): boolean {
  return /^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/.test(name);
}

/** Reserve slug and deploy to cloud */
async function deployToCloud(slug: string, token: string): Promise<string> {
  const reserveResult = await reserveProjectSlug(slug, token);

  const { pushCommand } = await import("../push/index.ts");
  await pushCommand({
    projectDir: cwd(),
    branch: "main",
    force: true,
    dryRun: false,
    quiet: true,
  });

  const { deployCommand: deployCmd } = await import("../deploy/index.ts");
  await deployCmd({
    branch: "main",
    env: "production",
    force: true,
    dryRun: false,
    quiet: true,
  });

  return reserveResult.slug;
}

// ============================================================================
// Main Command
// ============================================================================

export async function newCommand(
  name: string,
  options: Partial<NewOptions> = {},
  env: EnvironmentConfig = getEnvironmentConfig(),
): Promise<void> {
  let {
    template,
    integrations: integrationsStr,
    port = 3000,
    deploy = false,
    open = true,
    force = false,
  } = options;

  let integrations = parseIntegrations(integrationsStr);
  const fs = createFileSystem();

  // Check for existing token (for display purposes only - no auth required yet)
  const existingToken = env.apiToken || (await readToken());
  const userInfo = existingToken ? await validateToken(existingToken) : null;

  // Interactive template selection (TTY only)
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

  // Validation
  if (!isValidProjectName(name)) {
    console.error(errorText("Invalid project name. Use lowercase letters, numbers, and hyphens."));
    exitProcess(1);
    return;
  }

  try {
    const stat = await fs.stat(projectDir);
    if (stat.isDirectory && !force) {
      console.error(errorText(`Directory "${name}" exists. Use --force to overwrite.`));
      exitProcess(1);
      return;
    }
  } catch {
    // Directory doesn't exist - OK
  }

  // Non-TTY: simple local creation
  if (!isTTY()) {
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
    console.log(dim(`  cd ${name} && veryfront dev`));
    console.log();
    return;
  }

  // --deploy flag: create locally then deploy immediately
  if (deploy) {
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

    const authResult = await ensureAuthenticated(env);
    if (!authResult) {
      console.log();
      console.log(dim(`  cd ${name} && veryfront push`));
      console.log();
      return;
    }

    const token = await readToken();
    if (token) {
      console.log(`  ${dim("●")} Deploying...`);
      chdir(projectDir);
      const actualSlug = await deployToCloud(slug, token);
      console.log(`  ${success("●")} Deployed to https://${actualSlug}.veryfront.com`);
    }

    console.log();
    console.log(dim(`  cd ${name} && veryfront dev`));
    console.log();
    return;
  }

  // TTY mode: Full TUI with dev server (no auth required to start)
  const tui = createTui({ title: "Veryfront Code", showLogs: true });
  const restore = interceptConsole(tui);

  const localUrl = `http://${name}.veryfront.me:${port}`;
  const prodUrl = `https://${slug}.veryfront.com`;

  tui.setInfo({
    Local: `${dim("○")} ${brand(localUrl)}`,
    Production: `${dim("○")} ${brand(prodUrl)}`,
  });
  tui.setStatus("Creating...", "loading");

  let shouldExit = false;

  try {
    // Scaffold and start dev server
    await fs.mkdir(projectDir, { recursive: true });
    await scaffoldProjectFast(projectDir, template as InitTemplate, slug, integrations);

    chdir(projectDir);
    const { devCommand } = await import("../dev/index.ts");
    const { ready } = await devCommand({ port, projectDir: cwd(), hmr: true });
    await ready;

    if (open && canOpenBrowser()) {
      await openBrowser(localUrl);
    }

    tui.setInfo({
      Local: `${success("●")} ${brand(localUrl)}`,
      Production: `${dim("○")} ${brand(prodUrl)}`,
    });
    tui.setStatus("Ready", "success");

    // Wait for user input
    await handleInput(tui, {
      onEnter: () => {},
      onExit: () => {
        shouldExit = true;
      },
    });

    if (shouldExit) {
      tui.cleanup();
      exitProcess(0);
      return;
    }

    // User pressed Enter - authenticate if needed, then deploy
    let token = env.apiToken || (await readToken());
    if (!token) {
      restore();
      tui.cleanup();

      const authResult = await ensureAuthenticated(env);
      if (!authResult) {
        console.log();
        console.log(dim("  Deploy cancelled. Your project is ready locally."));
        console.log(dim(`  Run 'veryfront push' when you're ready to deploy.`));
        console.log();
        exitProcess(0);
        return;
      }

      token = await readToken();
      if (!token) {
        console.log();
        console.log(errorText("  Authentication failed."));
        console.log();
        exitProcess(1);
        return;
      }
    }

    // Deploy
    tui.setStatus("Deploying...", "loading");
    const actualSlug = await deployToCloud(slug, token);

    tui.setInfo({
      Local: `${success("●")} ${brand(localUrl)}`,
      Production: `${success("●")} ${brand(`https://${actualSlug}.veryfront.com`)}`,
    });
    tui.setStatus("Deployed", "success");

    await handleInput(tui, {
      onEnter: () => {},
      onExit: () => {},
    });

    tui.cleanup();
    exitProcess(0);
  } catch (err) {
    tui.setStatus(err instanceof Error ? err.message : String(err), "error");
    await new Promise((r) => setTimeout(r, 2000));
    tui.cleanup();
    restore();
    exitProcess(1);
  }
}
