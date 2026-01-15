/**
 * New command - Lightning-fast project creation for pro coders
 *
 * One command: create -> preview -> deploy
 *
 * @module cli/commands/new
 */

// Use console.log for clean demo output (no timestamp/prefix)
import { cyan, dim, green, red } from "@veryfront/compat/console";
import { chdir, cwd, getEnv } from "@veryfront/platform/compat/process.ts";
import { join } from "@veryfront/platform/compat/path/index.ts";
import { createFileSystem } from "@veryfront/platform/compat/fs.ts";
import { waitForEnterOrExit } from "@veryfront/platform/compat/stdin.ts";
import { z } from "zod";

import { readToken, validateToken } from "../auth/index.ts";
import { canOpenBrowser, openBrowser } from "../auth/browser.ts";
import { exitProcess, getColorEnabled, isTTY } from "../utils/index.ts";
import { CommonArgs, createArgParser } from "../shared/args.ts";
import { scaffoldProjectFast, type ScaffoldResult } from "./new/fast-scaffold.ts";
import { reserveProjectSlug } from "./new/reserve-slug.ts";
import { runInteractiveWizard, shouldRunWizard } from "./init/interactive-wizard.ts";
import type { InitTemplate } from "./init/types.ts";
import type { IntegrationName } from "../templates/types.ts";

// ============================================================================
// Types
// ============================================================================

export const NewArgsSchema = z.object({
  template: z.enum(["ai", "app", "blog", "docs", "minimal"]).optional(),
  integrations: z.string().optional(), // Comma-separated list
  port: z.number().default(3000),
  skipDeploy: z.boolean().default(false),
  open: z.boolean().default(true),
  force: z.boolean().default(false),
});

export type NewOptions = z.infer<typeof NewArgsSchema> & {
  // Parsed integrations array
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

function useColor() {
  const enabled = getColorEnabled();
  return (fn: (s: string) => string, s: string) => (enabled ? fn(s) : s);
}

/**
 * Generate a random suffix for unique slugs (e.g., "x7k2m9")
 */
function generateRandomSuffix(length = 6): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

// ============================================================================
// Main Command
// ============================================================================

export async function newCommand(
  name: string,
  options: Partial<NewOptions> = {},
): Promise<void> {
  const c = useColor();
  let {
    template,
    integrations: integrationsStr,
    port = 3000,
    skipDeploy = false,
    open = true,
    force = false,
  } = options;

  // Parse integrations string to array
  let integrations: IntegrationName[] = integrationsStr
    ? integrationsStr.split(",").map((s) => s.trim()).filter(Boolean) as IntegrationName[]
    : [];

  const fs = createFileSystem();

  // -------------------------------------------------------------------------
  // Step 0: Interactive wizard (if no template specified)
  // -------------------------------------------------------------------------

  if (shouldRunWizard({ template, integrations }) && isTTY()) {
    const wizardResult = await runInteractiveWizard();
    if (!wizardResult.skipped) {
      template = wizardResult.template;
      integrations = wizardResult.integrations;
    }
  }

  // Default to "ai" template if still not set
  if (!template) {
    template = "ai";
  }
  const projectDir = join(cwd(), name);

  // Generate unique slug with random suffix to avoid conflicts
  const slug = `${name}-${generateRandomSuffix()}`;

  // -------------------------------------------------------------------------
  // Step 1: Validate inputs
  // -------------------------------------------------------------------------

  // Check name is valid
  const slugRegex = /^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/;
  if (!slugRegex.test(name)) {
    console.error(`Invalid project name: "${name}"`);
    console.log(c(dim, "Use lowercase letters, numbers, and hyphens only."));
    exitProcess(1);
    return;
  }

  // Check directory doesn't exist
  try {
    const stat = await fs.stat(projectDir);
    if (stat.isDirectory && !force) {
      console.error(`Directory "${name}" already exists.`);
      console.log(c(dim, "Use --force to overwrite."));
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
    console.log("");
    console.log(c(red, "  Please log in first:"));
    console.log("");
    console.log(c(dim, "    deno task cli login"));
    console.log("");
    exitProcess(1);
    return;
  }

  // Validate token in background (don't block)
  const userInfoPromise = validateToken(token);

  // -------------------------------------------------------------------------
  // Step 3: Show header with optimistic URLs
  // -------------------------------------------------------------------------

  console.log("");
  console.log(`  ${c(cyan, "\u26A1")} ${c(cyan, "Veryfront")}`);
  console.log("");

  // Show user email when available
  const userInfo = await userInfoPromise;
  if (userInfo) {
    console.log(`  ${c(dim, userInfo.email)}`);
    console.log("");
  }

  console.log(`  Creating ${c(cyan, slug)}...`);
  console.log("");
  console.log(`  Local   ${c(cyan, `http://${name}.lvh.me:${port}`)}`);
  console.log(`  Live    ${c(cyan, `https://${slug}.veryfront.com`)}`);
  console.log("");

  // -------------------------------------------------------------------------
  // Step 4: Parallel operations - scaffold + reserve slug
  // -------------------------------------------------------------------------

  // Create directory
  await fs.mkdir(projectDir, { recursive: true });

  let scaffoldResult: ScaffoldResult;
  let actualSlug = slug;

  if (skipDeploy) {
    // Skip API call, just scaffold locally
    scaffoldResult = await scaffoldProjectFast(projectDir, template as InitTemplate, slug, integrations);
    console.log(`  ${c(green, "\u2713")} Created ${scaffoldResult.filesWritten} files`);
    console.log("");
    console.log(c(dim, `  cd ${name} && deno task cli dev`));
    console.log("");
    return;
  }

  // Run scaffold and slug reservation in parallel
  const [scaffoldRes, reserveResult] = await Promise.all([
    scaffoldProjectFast(projectDir, template as InitTemplate, slug, integrations),
    reserveProjectSlug(slug, token),
  ]);

  scaffoldResult = scaffoldRes;
  actualSlug = reserveResult.slug;

  // -------------------------------------------------------------------------
  // Step 5: Start dev server
  // -------------------------------------------------------------------------

  // Change to project directory
  chdir(projectDir);

  // Start dev server and wait for it to be ready
  await startDevServer(port);

  // Open browser AFTER server is ready
  if (open && canOpenBrowser()) {
    await openBrowser(`http://${name}.lvh.me:${port}`);
  }

  console.log(`  ${c(green, "\u2713")} Ready`);
  console.log("");
  console.log(`  Press ${c(cyan, "Enter")} to deploy, ${c(dim, "Ctrl+C")} to exit`);
  console.log("");

  // -------------------------------------------------------------------------
  // Step 6: Wait for Enter, then deploy
  // -------------------------------------------------------------------------

  if (!isTTY()) {
    // Non-interactive mode: just exit
    return;
  }

  const shouldDeploy = await waitForEnterOrExit();

  if (!shouldDeploy) {
    // User pressed Ctrl+C - exit without deploying
    console.log("");
    exitProcess(0);
    return;
  }

  console.log(`  Deploying...`);
  console.log("");

  // Deploy: push + create release + create deployment
  const deployed = await deployProject();

  if (deployed) {
    console.log(`  ${c(green, "\u2713")} Done!`);
    console.log("");
    console.log(`  ${c(cyan, `https://${actualSlug}.veryfront.com`)}`);
    console.log("");
  }
}

// ============================================================================
// Dev Server
// ============================================================================

async function startDevServer(port: number): Promise<void> {
  const { devCommand } = await import("./dev.ts");

  const { ready } = await devCommand({
    port,
    projectDir: cwd(),
    hmr: true,
  });

  await ready;
}

// ============================================================================
// Deploy
// ============================================================================

async function deployProject(): Promise<boolean> {
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

    // Create release and deployment to production
    await deployCommand({
      branch: "main",
      env: "production",
      force: true,
      dryRun: false,
    });

    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(`  ${c(red, "\u2717")} Deploy failed: ${message}`);
    return false;
  }
}
