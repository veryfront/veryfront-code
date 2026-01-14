/**
 * New command - Lightning-fast project creation for pro coders
 *
 * One command: create -> preview -> deploy
 *
 * @module cli/commands/new
 */

import { cliLogger } from "@veryfront/utils";
import { cyan, dim, green, red } from "@veryfront/compat/console";
import { chdir, cwd, getEnv } from "@veryfront/platform/compat/process.ts";
import { join } from "@veryfront/platform/compat/path/index.ts";
import { createFileSystem } from "@veryfront/platform/compat/fs.ts";
import { z } from "zod";

import { readToken, validateToken } from "../auth/index.ts";
import { canOpenBrowser, openBrowser } from "../auth/browser.ts";
import { exitProcess, getColorEnabled, isTTY } from "../utils/index.ts";
import { CommonArgs, createArgParser } from "../shared/args.ts";
import { scaffoldProjectFast, type ScaffoldResult } from "./new/fast-scaffold.ts";
import { reserveProjectSlug } from "./new/reserve-slug.ts";
import type { InitTemplate } from "./init/types.ts";

// ============================================================================
// Types
// ============================================================================

export const NewArgsSchema = z.object({
  template: z.enum(["ai", "app", "blog", "docs", "minimal"]).default("ai"),
  port: z.number().default(3000),
  skipDeploy: z.boolean().default(false),
  open: z.boolean().default(true),
  force: z.boolean().default(false),
});

export type NewOptions = z.infer<typeof NewArgsSchema>;

export const parseNewArgs = createArgParser(NewArgsSchema, {
  template: { keys: ["template", "t"], type: "string" },
  port: { keys: ["port", "p"], type: "number" },
  skipDeploy: { keys: ["skip-deploy"], type: "boolean" },
  open: { keys: ["open", "o"], type: "boolean" },
  force: CommonArgs.force,
});

// ============================================================================
// Helpers
// ============================================================================

function useColor() {
  const enabled = getColorEnabled();
  return (fn: (s: string) => string, s: string) => (enabled ? fn(s) : s);
}

// ============================================================================
// Main Command
// ============================================================================

export async function newCommand(
  name: string,
  options: Partial<NewOptions> = {},
): Promise<void> {
  const c = useColor();
  const {
    template = "ai",
    port = 3000,
    skipDeploy = false,
    open = true,
    force = false,
  } = options;

  const fs = createFileSystem();
  const projectDir = join(cwd(), name);

  // -------------------------------------------------------------------------
  // Step 1: Validate inputs
  // -------------------------------------------------------------------------

  // Check name is valid
  const slugRegex = /^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/;
  if (!slugRegex.test(name)) {
    cliLogger.error(`Invalid project name: "${name}"`);
    cliLogger.info(c(dim, "Use lowercase letters, numbers, and hyphens only."));
    exitProcess(1);
    return;
  }

  // Check directory doesn't exist
  try {
    const stat = await fs.stat(projectDir);
    if (stat.isDirectory && !force) {
      cliLogger.error(`Directory "${name}" already exists.`);
      cliLogger.info(c(dim, "Use --force to overwrite."));
      exitProcess(1);
      return;
    }
  } catch {
    // Directory doesn't exist, which is what we want
  }

  // -------------------------------------------------------------------------
  // Step 2: Check authentication (fast - cached token)
  // -------------------------------------------------------------------------

  const envToken = getEnv("VERYFRONT_API_TOKEN");
  const storedToken = await readToken();
  const token = envToken || storedToken;

  if (!token) {
    cliLogger.info("");
    cliLogger.info(c(red, "  Please log in first:"));
    cliLogger.info("");
    cliLogger.info(c(dim, "    deno task cli login"));
    cliLogger.info("");
    exitProcess(1);
    return;
  }

  // Validate token in background (don't block)
  const userInfoPromise = validateToken(token);

  // -------------------------------------------------------------------------
  // Step 3: Show header with optimistic URLs
  // -------------------------------------------------------------------------

  cliLogger.info("");
  cliLogger.info(`  ${c(cyan, "\u26A1")} ${c(cyan, "Veryfront")}`);
  cliLogger.info("");

  // Show user email when available
  const userInfo = await userInfoPromise;
  if (userInfo) {
    cliLogger.info(`  ${c(dim, userInfo.email)}`);
    cliLogger.info("");
  }

  cliLogger.info(`  Creating ${c(cyan, name)}...`);
  cliLogger.info("");
  cliLogger.info(`  Local   ${c(cyan, `http://${name}.lvh.me:${port}`)}`);
  cliLogger.info(`  Live    ${c(cyan, `https://${name}.veryfront.app`)}`);
  cliLogger.info("");

  // -------------------------------------------------------------------------
  // Step 4: Parallel operations - scaffold + reserve slug
  // -------------------------------------------------------------------------

  // Create directory
  await fs.mkdir(projectDir, { recursive: true });

  let scaffoldResult: ScaffoldResult;
  let actualSlug = name;

  if (skipDeploy) {
    // Skip API call, just scaffold locally
    scaffoldResult = await scaffoldProjectFast(projectDir, template as InitTemplate, name);
    cliLogger.info(`  ${c(green, "\u2713")} Created ${scaffoldResult.filesWritten} files`);
    cliLogger.info("");
    cliLogger.info(c(dim, `  cd ${name} && deno task cli dev`));
    cliLogger.info("");
    return;
  }

  // Run scaffold and slug reservation in parallel
  const [scaffoldRes, reserveResult] = await Promise.all([
    scaffoldProjectFast(projectDir, template as InitTemplate, name),
    reserveProjectSlug(name, token),
  ]);

  scaffoldResult = scaffoldRes;

  // Handle slug conflict
  if (reserveResult.slug !== name) {
    cliLogger.info(c(dim, `  "${name}" is taken, using "${reserveResult.slug}"`));
    cliLogger.info("");
    actualSlug = reserveResult.slug;

    // Update .veryfrontrc with the actual slug
    const veryfrontrcPath = join(projectDir, ".veryfrontrc");
    const veryfrontrc = JSON.stringify({ projectSlug: actualSlug }, null, 2) + "\n";
    await fs.writeFile(veryfrontrcPath, new TextEncoder().encode(veryfrontrc));
  }

  // -------------------------------------------------------------------------
  // Step 5: Start dev server
  // -------------------------------------------------------------------------

  // Change to project directory
  chdir(projectDir);

  // Start dev server in background
  const devServerPromise = startDevServer(port);

  // Open browser
  if (open && canOpenBrowser()) {
    await openBrowser(`http://${name}.lvh.me:${port}`);
  }

  // Wait for server to be ready
  await devServerPromise;

  cliLogger.info(`  ${c(green, "\u2713")} Ready`);
  cliLogger.info("");
  cliLogger.info(`  Press ${c(cyan, "Enter")} to deploy, ${c(dim, "Ctrl+C")} to exit`);
  cliLogger.info("");

  // -------------------------------------------------------------------------
  // Step 6: Wait for Enter, then deploy
  // -------------------------------------------------------------------------

  if (!isTTY()) {
    // Non-interactive mode: just exit
    return;
  }

  await waitForKeypress();

  cliLogger.info(`  Deploying...`);
  cliLogger.info("");

  // Deploy: push + create release + create deployment
  const deployed = await deployProject(actualSlug, token);

  if (deployed) {
    cliLogger.info(`  ${c(green, "\u2713")} Done!`);
    cliLogger.info("");
    cliLogger.info(`  ${c(cyan, `https://${actualSlug}.veryfront.app`)}`);
    cliLogger.info("");
  }
}

// ============================================================================
// Dev Server
// ============================================================================

async function startDevServer(port: number): Promise<void> {
  // Import dev command dynamically to avoid circular deps
  const { devCommand } = await import("./dev.ts");

  // Start dev server in background (don't await - let it run)
  // Note: devCommand will block, so we use a timeout to return early
  const serverPromise = devCommand({
    port,
    projectDir: cwd(),
    hmr: true,
  });

  // Race: wait for server to potentially fail or timeout
  await Promise.race([
    serverPromise.catch(() => {}), // Swallow errors for now
    new Promise((resolve) => setTimeout(resolve, 500)),
  ]);
}

// ============================================================================
// Deploy
// ============================================================================

async function deployProject(_slug: string, _token: string): Promise<boolean> {
  const c = useColor();

  try {
    // Import deploy commands
    const { pushCommand } = await import("./push.ts");
    const { deployCommand } = await import("./deploy.ts");

    // Push files to remote
    await pushCommand({
      projectDir: cwd(),
      branch: "main",
      force: true,
      dryRun: false,
    });

    // Create release and deployment
    await deployCommand({
      branch: "main",
      env: "preview",
      force: true,
      dryRun: false,
    });

    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    cliLogger.info(`  ${c(red, "\u2717")} Deploy failed: ${message}`);
    return false;
  }
}

// ============================================================================
// Input Handling
// ============================================================================

function waitForKeypress(): Promise<void> {
  return new Promise((resolve) => {
    // @ts-ignore - Deno global
    if (typeof Deno !== "undefined" && Deno.stdin) {
      // @ts-ignore - Deno global
      Deno.stdin.setRaw(true);
      const reader = Deno.stdin.readable.getReader();

      reader.read().then(({ value: _value }) => {
        // @ts-ignore - Deno global
        Deno.stdin.setRaw(false);
        reader.releaseLock();
        resolve();
      });
    } else {
      // Node.js fallback
      process.stdin.setRawMode?.(true);
      process.stdin.resume();
      process.stdin.once("data", () => {
        process.stdin.setRawMode?.(false);
        process.stdin.pause();
        resolve();
      });
    }
  });
}
