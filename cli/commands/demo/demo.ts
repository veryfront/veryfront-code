/**
 * Demo command - Interactive guided tour of Veryfront CLI
 *
 * @module cli/commands/demo
 */

import { chdir, cwd, promptSync, writeStdout } from "veryfront/platform";
import { getStdinReader, setRawMode } from "veryfront/platform";
import { join } from "veryfront/platform/path";
import {
  AnimatedDotMatrix,
  bold,
  brand,
  dim,
  error,
  formatDuration,
  HIDE_CURSOR,
  muted,
  SHOW_CURSOR,
  success,
  successBanner,
  typeCommand,
  typeLine,
} from "#cli/ui";
import { exitProcess, isTTY } from "#cli/utils";
import { readToken, saveToken, validateToken } from "../../auth/index.ts";
import { canOpenBrowser, openBrowser } from "../../auth/browser.ts";
import { getCallbackUrl, startCallbackServer } from "../../auth/callback-server.ts";
import { DEFAULT_LOGIN_TIMEOUT_MS, getApiUrl } from "#cli/shared/constants";
import { newCommand } from "../new/index.ts";
import { deployCommand } from "../deploy/index.ts";
import { pushCommand } from "../push/index.ts";
import { devCommand } from "../dev/index.ts";
import { reserveProjectSlug } from "../new/reserve-slug.ts";
import { readConfigFile } from "#cli/shared/config";
import { DEMO_STEPS, type DemoStep } from "./steps.ts";

// ANSI escape codes
const ESC = "\x1b";
const CLEAR_SCREEN = `${ESC}[2J`;
const MOVE_HOME = `${ESC}[H`;

function write(s: string): void {
  writeStdout(s);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type AuthMethod = "google" | "github" | "microsoft" | "token";

const AUTH_OPTIONS: { id: AuthMethod; label: string }[] = [
  { id: "google", label: "Google" },
  { id: "github", label: "GitHub" },
  { id: "microsoft", label: "Microsoft" },
  { id: "token", label: "API Token" },
];

function clearCountdownLine(): void {
  write(`\r  ${" ".repeat(30)}\r`);
}

async function countdown(message: (i: number) => string, seconds = 3): Promise<void> {
  for (let i = seconds; i > 0; i--) {
    write(`\r  ${muted(message(i))}`);
    await delay(1000);
  }
  clearCountdownLine();
}

function drawAuthOptions(selectedIndex: number): void {
  for (let i = 0; i < AUTH_OPTIONS.length; i++) {
    const opt = AUTH_OPTIONS[i]!;
    console.log(i === selectedIndex ? `  ${brand("❯")} ${opt.label}` : `    ${muted(opt.label)}`);
  }
}

function redrawAuthOptions(): void {
  write(`\x1b[${AUTH_OPTIONS.length}A`);
  for (let i = 0; i < AUTH_OPTIONS.length; i++) {
    write("\x1b[2K");
    write("\x1b[1B");
  }
  write(`\x1b[${AUTH_OPTIONS.length}A`);
}

/**
 * Demo-specific login with clean output styling
 */
async function demoLogin(preselectedMethod?: AuthMethod): Promise<boolean> {
  let method: AuthMethod | null = preselectedMethod ?? null;
  const preselectedIndex = method ? AUTH_OPTIONS.findIndex((o) => o.id === method) : 0;

  if (autoMode) {
    method ??= AUTH_OPTIONS[0]!.id;

    console.log();
    console.log(`  ${dim("Choose authentication method:")}`);
    console.log();
    drawAuthOptions(preselectedIndex);
    console.log();

    await countdown((i) => `Auto-selecting in ${i}...`);
  } else if (!method) {
    console.log();
    console.log(`  ${dim("Choose authentication method:")}`);
    console.log();

    let currentIndex = 0;
    drawAuthOptions(currentIndex);

    setRawMode(true);
    const reader = getStdinReader();
    const dec = new TextDecoder();

    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) return false;

        const key = dec.decode(value);

        if (key === "\x03") return false;

        if (key === "\r" || key === "\n") {
          method = AUTH_OPTIONS[currentIndex]!.id;
          break;
        }

        if (key === "\x1b[A" || key === "k") {
          currentIndex = Math.max(0, currentIndex - 1);
        } else if (key === "\x1b[B" || key === "j") {
          currentIndex = Math.min(AUTH_OPTIONS.length - 1, currentIndex + 1);
        } else if (key >= "1" && key <= "4") {
          method = AUTH_OPTIONS[Number.parseInt(key, 10) - 1]?.id ?? null;
          if (method) break;
        }

        redrawAuthOptions();
        drawAuthOptions(currentIndex);
      }
    } finally {
      reader.releaseLock();
      setRawMode(false);
    }
  }

  if (!method) return false;

  console.log();

  if (method === "token") {
    console.log(`  ${brand("Enter your API token")}`);
    console.log(`  ${dim("You can get a token from veryfront.com/settings/api-keys")}`);
    console.log();

    const tokenInput = promptSync("  API token:") ?? "";
    if (!tokenInput) {
      console.log();
      console.log(`  ${error("✗")} No token entered`);
      return false;
    }

    const userInfo = await validateToken(tokenInput);
    if (!userInfo) {
      console.log();
      console.log(`  ${error("✗")} Invalid token`);
      return false;
    }

    await saveToken(tokenInput);
    console.log();
    console.log(`  ${success("✓")} Logged in as ${brand(userInfo.email)}`);
    return true;
  }

  if (!canOpenBrowser()) {
    console.log(`  ${error("Browser login not available in this environment.")}`);
    return false;
  }

  console.log(`  ${dim("Starting authentication server...")}`);

  let server: Awaited<ReturnType<typeof startCallbackServer>>;
  try {
    server = await startCallbackServer();
  } catch (e) {
    console.log(`  ${error(`Failed to start server: ${e}`)}`);
    return false;
  }

  const callbackUrl = getCallbackUrl(server.port);
  const authUrl = `${getApiUrl()}/auth/${method}?redirect_uri=${encodeURIComponent(callbackUrl)}`;

  console.log(`  ${brand("Opening browser to log in...")}`);
  console.log();
  console.log(`  ${dim("If the browser doesn't open, visit:")}`);
  console.log(`  ${dim(authUrl)}`);
  console.log();

  try {
    await openBrowser(authUrl);
  } catch {
    console.log(`  ${dim("Could not open browser automatically.")}`);
  }

  console.log(`  ${muted("Waiting for login...")}`);

  try {
    const result = await server.waitForCallback(DEFAULT_LOGIN_TIMEOUT_MS);

    if (result.error || !result.token) {
      console.log();
      console.log(`  ${error("✗")} Login failed: ${result.error || "No token received"}`);
      return false;
    }

    const userInfo = await validateToken(result.token);
    if (!userInfo) {
      console.log();
      console.log(`  ${error("✗")} Invalid token received`);
      return false;
    }

    await saveToken(result.token);

    console.log();
    console.log(`  ${success("✓")} Logged in as ${brand(userInfo.email)}`);
    return true;
  } catch (e) {
    console.log();
    console.log(`  ${error("✗")} ${e instanceof Error ? e.message : String(e)}`);
    return false;
  } finally {
    await server.stop();
  }
}

/**
 * Wait for Enter key press or auto-advance after timeout
 * Returns false if Ctrl+C was pressed (cancel)
 */
async function waitForEnter(prompt?: string): Promise<boolean> {
  if (autoMode) {
    console.log();
    await countdown((i) => `Auto-continuing in ${i}...`);
    return true;
  }

  if (prompt) {
    console.log();
    console.log(`  ${muted(prompt)}`);
  }

  setRawMode(true);
  const reader = getStdinReader();
  const dec = new TextDecoder();

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) return false;

      const key = dec.decode(value);
      if (key === "\x03") return false;
      if (key === "\r" || key === "\n") return true;
    }
  } finally {
    reader.releaseLock();
    setRawMode(false);
  }
}

/**
 * Display a single demo step with animated text
 */
async function displayStep(
  step: DemoStep,
  stepNum: number,
  total: number,
  projectName: string,
): Promise<void> {
  write(CLEAR_SCREEN + MOVE_HOME);

  console.log();
  console.log(`  ${muted(`[${stepNum}/${total}]`)} ${bold(brand(step.title))}`);
  console.log();

  for (const line of step.description) {
    write("  ");
    await typeLine(line, { charDelay: 20 });
  }

  if (!step.command) return;

  const displayCommand = step.command.replace("demo-app", projectName);
  console.log();
  await typeCommand(displayCommand, { charDelay: 40 });
}

/**
 * Execute the action for a step
 */
async function executeStepAction(
  step: DemoStep,
  projectName: string,
  loginMethod?: AuthMethod,
): Promise<void> {
  switch (step.id) {
    case "login": {
      const existingToken = await readToken();
      if (existingToken) {
        const userInfo = await validateToken(existingToken);
        if (userInfo) {
          console.log();
          console.log(`  ${success("✓")} Already logged in as ${brand(userInfo.email)}`);
          return;
        }
      }

      await demoLogin(loginMethod);
      return;
    }

    case "create": {
      await newCommand(projectName, { template: "chat", force: true });

      const projectDir = join(cwd(), projectName);
      const actualSlug = (await readConfigFile(projectDir))?.projectSlug;
      if (!actualSlug) return;

      actualProjectSlug = actualSlug;

      const token = await readToken();
      if (!token) return;

      console.log();
      console.log(`  ${dim("Registering project...")}`);

      try {
        await reserveProjectSlug(actualSlug, token);
        console.log(`  ${success("✓")} Project registered`);

        console.log(`  ${dim("Pushing code...")}`);
        chdir(projectDir);
        await pushCommand({
          projectDir,
          branch: "main",
          force: true,
          dryRun: false,
          quiet: true,
        });
        console.log(`  ${success("✓")} Code pushed`);
      } catch (e) {
        console.log(`  ${error("✗")} ${e instanceof Error ? e.message : String(e)}`);
      }
      return;
    }

    case "dev": {
      const projectDir = cwd();

      if (autoMode) {
        console.log();
        console.log(`  ${dim("Skipping dev server in auto mode...")}`);
        console.log();
        console.log(`  ${success("✓")} Dev server skipped`);
        return;
      }

      console.log();
      console.log(`  ${dim("Starting dev server...")}`);

      try {
        const result = await devCommand({
          port: 3000,
          projectDir,
          hmr: true,
          demoMode: true,
        });

        await result.ready;

        console.log(`  ${success("●")} ${brand("http://localhost:3000/")}`);
        console.log();

        console.log(`  ${dim("Opening browser...")}`);
        try {
          await openBrowser("http://localhost:3000");
        } catch {
          // Ignore if browser can't be opened
        }

        console.log();
        console.log(`  ${dim("Press Enter to stop the dev server and continue...")}`);

        await waitForEnter();

        console.log();
        console.log(`  ${dim("Stopping dev server...")}`);
        await result.stop();
        await result.done;
      } catch (e) {
        console.log(`  ${error("✗")} ${e instanceof Error ? e.message : String(e)}`);
      }

      await delay(500);
      console.log();
      console.log(`  ${success("✓")} Dev server stopped`);
      return;
    }

    case "deploy": {
      console.log();
      console.log(`  ${dim("Deploying to production...")}`);

      try {
        await deployCommand({
          branch: "main",
          env: "production",
          quiet: true,
          force: true,
          dryRun: false,
        });

        const deployedUrl = `https://${actualProjectSlug ?? projectName}.veryfront.com`;
        console.log(`  ${success("✓")} Deployed to ${brand(deployedUrl)}`);
      } catch (e) {
        console.log(
          `  ${error("✗")} Deploy failed: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
      return;
    }
  }
}

export interface DemoOptions {
  /** Project name for the demo (default: demo-{random}) */
  projectName?: string;
  /** Auto-advance through steps after 3 seconds */
  auto?: boolean;
  /** Pre-selected login method for auto mode */
  loginMethod?: AuthMethod;
}

let autoMode = false;
let actualProjectSlug: string | null = null;

interface StepTiming {
  startTime?: number;
  endTime?: number;
  duration?: number;
}

const stepTimings = new Map<string, StepTiming>();

function startStepTiming(stepId: string): void {
  stepTimings.set(stepId, { startTime: Date.now() });
}

function endStepTiming(stepId: string): void {
  const timing = stepTimings.get(stepId);
  if (!timing?.startTime) return;

  timing.endTime = Date.now();
  timing.duration = timing.endTime - timing.startTime;
}

function getStepDuration(stepId: string): number | undefined {
  return stepTimings.get(stepId)?.duration;
}

/**
 * Render a progress indicator showing all steps
 */
function renderProgress(currentStepIndex: number, steps: DemoStep[]): string {
  const lines: string[] = [];

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]!;
    const duration = getStepDuration(step.id);

    if (i < currentStepIndex) {
      const durationText = duration ? dim(` (${formatDuration(duration)})`) : "";
      lines.push(`  ${success("✓")} ${dim(step.title) + durationText}`);
      continue;
    }

    if (i === currentStepIndex) {
      lines.push(`  ${brand("●")} ${step.title}`);
      continue;
    }

    lines.push(`  ${muted("○")} ${muted(step.title)}`);
  }

  return lines.join("\n");
}

/**
 * Generate a random suffix for unique project names
 */
function generateRandomSuffix(): string {
  return Math.random().toString(36).substring(2, 8);
}

export async function demoCommand(options: DemoOptions = {}): Promise<void> {
  const defaultProjectName = `demo-${generateRandomSuffix()}`;
  const { projectName = defaultProjectName, auto = false, loginMethod } = options;

  autoMode = auto;

  if (!isTTY()) {
    console.log("Demo requires an interactive terminal.");
    return;
  }

  write(HIDE_CURSOR);

  try {
    write(CLEAR_SCREEN + MOVE_HOME);
    console.log();

    const matrix = new AnimatedDotMatrix({ litColor: "\x1b[38;2;252;143;93m" });
    const textLines = [
      bold(brand("Veryfront")),
      muted(`Interactive Demo${autoMode ? " (Auto Mode)" : ""}`),
    ];

    console.log(matrix.renderWithText(textLines));

    await matrix.spinRoundsWithText(
      2,
      textLines,
      (frame) => {
        write(`${ESC}[7A`);
        console.log(frame);
      },
      60,
    );

    console.log();

    write("  ");
    await typeLine("This guided tour will walk you through", { charDelay: 25 });
    write("  ");
    await typeLine("creating and deploying your first Veryfront app.", { charDelay: 25 });

    if (!(await waitForEnter("Press Enter to begin..."))) return;

    stepTimings.clear();

    const total = DEMO_STEPS.length;
    for (let i = 0; i < total; i++) {
      const step = DEMO_STEPS[i]!;

      startStepTiming(step.id);

      await displayStep(step, i + 1, total, projectName);

      console.log();
      console.log(dim("  ─────────────────────────────"));
      console.log();
      console.log(renderProgress(i, DEMO_STEPS));
      console.log();

      if (step.hasAction) {
        if (!(await waitForEnter("Press Enter to run..."))) return;

        console.log();
        await executeStepAction(step, projectName, loginMethod);

        endStepTiming(step.id);

        if (!step.skipPostWait && i < total - 1) {
          if (!(await waitForEnter("Press Enter to continue..."))) return;
        }
        continue;
      }

      endStepTiming(step.id);

      if (i < total - 1) {
        if (!(await waitForEnter("Press Enter to continue..."))) return;
      }
    }

    write(CLEAR_SCREEN + MOVE_HOME);
    const finalUrl = `https://${actualProjectSlug ?? projectName}.veryfront.com`;
    console.log();

    console.log(
      successBanner("Demo Complete! Your app is live.", {
        url: finalUrl,
        project: actualProjectSlug || projectName,
      }),
    );

    console.log();
    console.log(`  ${bold("Next steps:")}`);
    console.log();
    console.log(`  ${dim("1.")} Edit your app in ${brand(`${projectName}/`)}`);
    console.log(`  ${dim("2.")} Run ${brand("veryfront dev")} to start developing`);
    console.log(`  ${dim("3.")} Run ${brand("veryfront deploy")} to publish changes`);
    console.log();
    console.log(`  ${dim("Learn more at https://veryfront.com/docs")}`);
    console.log();

    await waitForEnter("Press Enter to exit...");
  } finally {
    write(SHOW_CURSOR);
  }

  exitProcess(0);
}
