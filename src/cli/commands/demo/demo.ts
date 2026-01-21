/**
 * Demo command - Interactive guided tour of Veryfront CLI
 *
 * @module cli/commands/demo
 */

import { chdir, cwd, promptSync, writeStdout } from "#veryfront/platform/compat/process.ts";
import { getStdinReader, setRawMode } from "#veryfront/platform/compat/stdin.ts";
import { join } from "#veryfront/platform/compat/path/index.ts";
import { bold, brand, dim, error, muted, success } from "../../ui/colors.ts";
import { AnimatedDotMatrix } from "../../ui/dot-matrix.ts";
import { HIDE_CURSOR, SHOW_CURSOR, typeCommand, typeLine } from "../../ui/animated-text.ts";
import { successBanner } from "../../ui/components/banner.ts";
import { formatDuration } from "../../ui/progress.ts";
import { exitProcess, isTTY } from "../../utils/index.ts";
import { readToken, saveToken, validateToken } from "../../auth/index.ts";
import { canOpenBrowser, openBrowser } from "../../auth/browser.ts";
import { getCallbackUrl, startCallbackServer } from "../../auth/callback-server.ts";
import { DEFAULT_LOGIN_TIMEOUT_MS, getApiUrl } from "../../auth/constants.ts";
import { newCommand } from "../new.ts";
import { deployCommand } from "../deploy.ts";
import { pushCommand } from "../push.ts";
import { devCommand } from "../dev.ts";
import { reserveProjectSlug } from "../new/reserve-slug.ts";
import { readConfigFile } from "../../shared/config.ts";
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

/**
 * Demo-specific login with clean output styling
 */
async function demoLogin(preselectedMethod?: AuthMethod): Promise<boolean> {
  let method: AuthMethod | null = preselectedMethod ?? null;

  // Determine selected index based on preselected method or default to first
  const selectedIndex = method ? AUTH_OPTIONS.findIndex((o) => o.id === method) : 0;

  // In auto mode, show list with countdown then auto-select
  if (autoMode) {
    if (!method) {
      method = AUTH_OPTIONS[0]!.id;
    }

    console.log();
    console.log("  " + dim("Choose authentication method:"));
    console.log();

    // Draw options with selected one highlighted
    for (let i = 0; i < AUTH_OPTIONS.length; i++) {
      const opt = AUTH_OPTIONS[i]!;
      if (i === selectedIndex) {
        console.log("  " + brand("❯") + " " + opt.label);
      } else {
        console.log("    " + muted(opt.label));
      }
    }

    // Countdown with line break
    console.log();
    const seconds = 3;
    for (let i = seconds; i > 0; i--) {
      write(`\r  ${muted(`Auto-selecting in ${i}...`)}`);
      await delay(1000);
    }
    write("\r  " + " ".repeat(30) + "\r"); // Clear countdown line
  } else if (!method) {
    // Interactive mode - show selection UI
    console.log();
    console.log("  " + dim("Choose authentication method:"));
    console.log();

    let currentIndex = 0;

    const drawOptions = () => {
      for (let i = 0; i < AUTH_OPTIONS.length; i++) {
        const opt = AUTH_OPTIONS[i]!;
        if (i === currentIndex) {
          console.log("  " + brand("❯") + " " + opt.label);
        } else {
          console.log("    " + muted(opt.label));
        }
      }
    };

    drawOptions();

    // Wait for selection
    setRawMode(true);
    const reader = getStdinReader();
    const dec = new TextDecoder();

    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        const key = dec.decode(value);

        if (key === "\x03") {
          // Ctrl+C
          return false;
        } else if (key === "\r" || key === "\n") {
          // Enter - select current
          method = AUTH_OPTIONS[currentIndex]!.id;
          break;
        } else if (key === "\x1b[A" || key === "k") {
          // Up arrow or k
          currentIndex = Math.max(0, currentIndex - 1);
        } else if (key === "\x1b[B" || key === "j") {
          // Down arrow or j
          currentIndex = Math.min(AUTH_OPTIONS.length - 1, currentIndex + 1);
        } else if (key >= "1" && key <= "4") {
          // Number selection
          method = AUTH_OPTIONS[parseInt(key) - 1]?.id ?? null;
          if (method) break;
        }

        // Redraw options
        // Move cursor up and clear lines
        write(`\x1b[${AUTH_OPTIONS.length}A`);
        for (let i = 0; i < AUTH_OPTIONS.length; i++) {
          write("\x1b[2K"); // Clear line
          write("\x1b[1B"); // Move down
        }
        write(`\x1b[${AUTH_OPTIONS.length}A`);
        drawOptions();
      }
    } finally {
      reader.releaseLock();
      setRawMode(false);
    }
  }

  if (!method) return false;

  console.log();

  // Handle token login separately
  if (method === "token") {
    console.log("  " + brand("Enter your API token"));
    console.log("  " + dim("You can get a token from veryfront.com/settings/api-keys"));
    console.log();

    const tokenInput = promptSync("  API token:") ?? "";

    if (!tokenInput) {
      console.log();
      console.log("  " + error("✗") + " No token entered");
      return false;
    }

    const userInfo = await validateToken(tokenInput);
    if (!userInfo) {
      console.log();
      console.log("  " + error("✗") + " Invalid token");
      return false;
    }

    await saveToken(tokenInput);
    console.log();
    console.log("  " + success("✓") + " Logged in as " + brand(userInfo.email));
    return true;
  }

  // OAuth login
  if (!canOpenBrowser()) {
    console.log("  " + error("Browser login not available in this environment."));
    return false;
  }

  const provider = method;

  console.log("  " + dim("Starting authentication server..."));

  let server;
  try {
    server = await startCallbackServer();
  } catch (err) {
    console.log("  " + error(`Failed to start server: ${err}`));
    return false;
  }

  const callbackUrl = getCallbackUrl(server.port);
  const authUrl = `${getApiUrl()}/auth/${provider}?redirect_uri=${
    encodeURIComponent(callbackUrl)
  }`;

  console.log("  " + brand("Opening browser to log in..."));
  console.log();
  console.log("  " + dim("If the browser doesn't open, visit:"));
  console.log("  " + dim(authUrl));
  console.log();

  try {
    await openBrowser(authUrl);
  } catch {
    console.log("  " + dim("Could not open browser automatically."));
  }

  console.log("  " + muted("Waiting for login..."));

  try {
    const result = await server.waitForCallback(DEFAULT_LOGIN_TIMEOUT_MS);

    if (result.error || !result.token) {
      console.log();
      console.log("  " + error("✗") + " Login failed: " + (result.error || "No token received"));
      return false;
    }

    // Validate and save token
    const userInfo = await validateToken(result.token);
    if (!userInfo) {
      console.log();
      console.log("  " + error("✗") + " Invalid token received");
      return false;
    }

    await saveToken(result.token);

    console.log();
    console.log("  " + success("✓") + " Logged in as " + brand(userInfo.email));

    return true;
  } catch (err) {
    console.log();
    console.log("  " + error("✗") + " " + (err instanceof Error ? err.message : String(err)));
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
    // Auto mode: show countdown and auto-advance
    console.log();
    const seconds = 3;
    for (let i = seconds; i > 0; i--) {
      write(`\r  ${muted(`Auto-continuing in ${i}...`)}`);
      await delay(1000);
    }
    write("\r  " + " ".repeat(30) + "\r"); // Clear countdown line
    return true;
  }

  if (prompt) {
    console.log();
    console.log("  " + muted(prompt));
  }

  setRawMode(true);
  const reader = getStdinReader();
  const dec = new TextDecoder();

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) return false;

      const key = dec.decode(value);

      // Ctrl+C to cancel
      if (key === "\x03") {
        return false;
      }

      // Enter to continue
      if (key === "\r" || key === "\n") {
        return true;
      }
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
  // Clear screen for clean presentation
  write(CLEAR_SCREEN + MOVE_HOME);

  // Step header
  console.log();
  console.log(`  ${muted(`[${stepNum}/${total}]`)} ${bold(brand(step.title))}`);
  console.log();

  // Animated description (each line typed separately)
  for (const line of step.description) {
    write("  ");
    await typeLine(line, { charDelay: 20 });
  }

  // Command (if any) - replace demo-app placeholder with actual project name
  if (step.command) {
    const displayCommand = step.command.replace("demo-app", projectName);
    console.log();
    await typeCommand(displayCommand, { charDelay: 40 });
  }
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
      // Check if already logged in
      const existingToken = await readToken();
      if (existingToken) {
        const userInfo = await validateToken(existingToken);
        if (userInfo) {
          console.log();
          console.log("  " + success("✓") + " Already logged in as " + brand(userInfo.email));
          break;
        }
      }
      await demoLogin(loginMethod);
      break;
    }

    case "create": {
      // Create project locally
      await newCommand(projectName, { template: "ai", skipDeploy: true, force: true });

      // Get the actual slug from the config (newCommand adds a random suffix)
      const projectDir = join(cwd(), projectName);
      const config = await readConfigFile(projectDir);
      const actualSlug = config?.projectSlug;

      // Store for use in completion screen
      if (actualSlug) {
        actualProjectSlug = actualSlug;

        // Get token for API calls
        const token = await readToken();
        if (token) {
          console.log();
          console.log("  " + dim("Registering project..."));

          // Reserve the slug on the API
          try {
            await reserveProjectSlug(actualSlug, token);
            console.log("  " + success("✓") + " Project registered");

            // Push the code to the server
            console.log("  " + dim("Pushing code..."));
            chdir(projectDir);
            await pushCommand({
              projectDir,
              branch: "main",
              force: true,
              dryRun: false,
              quiet: true,
            });
            console.log("  " + success("✓") + " Code pushed");
          } catch (err) {
            console.log(
              "  " + error("✗") + " " + (err instanceof Error ? err.message : String(err)),
            );
          }
        }
      }
      break;
    }

    case "dev": {
      // We're already in the project directory after the create step
      // Use cwd() directly instead of joining with projectName again
      const projectDir = cwd();

      // In auto mode, skip the dev server (it requires manual Ctrl+C)
      if (autoMode) {
        console.log();
        console.log("  " + dim("Skipping dev server in auto mode..."));
        console.log();
        console.log("  " + success("✓") + " Dev server skipped");
        break;
      }

      // Start dev server in demo mode (won't exit process on Ctrl+C)
      console.log();
      console.log("  " + dim("Starting dev server..."));

      try {
        const result = await devCommand({
          port: 3000,
          projectDir,
          hmr: true,
          demoMode: true,
        });

        // Wait for server to be ready
        await result.ready;

        console.log("  " + success("●") + " " + brand("http://localhost:3000/"));
        console.log();

        // Auto-open browser
        console.log("  " + dim("Opening browser..."));
        try {
          await openBrowser("http://localhost:3000");
        } catch {
          // Ignore if browser can't be opened
        }

        console.log();
        console.log("  " + dim("Press Enter to stop the dev server and continue..."));

        // Wait for Enter key press
        await waitForEnter();

        // Stop the dev server gracefully
        console.log();
        console.log("  " + dim("Stopping dev server..."));
        await result.stop();
        await result.done;
      } catch (err) {
        console.log("  " + error("✗") + " " + (err instanceof Error ? err.message : String(err)));
      }

      // Small delay to ensure terminal is ready for next step
      await delay(500);
      console.log();
      console.log("  " + success("✓") + " Dev server stopped");
      break;
    }

    case "deploy": {
      console.log();
      console.log("  " + dim("Deploying to production..."));
      try {
        await deployCommand({
          branch: "main",
          env: "production",
          quiet: true, // Use quiet mode to avoid spinner issues
          force: true, // Skip confirmation in demo
          dryRun: false,
        });
        // Show success with the deployed URL in blue
        const deployedUrl = actualProjectSlug
          ? `https://${actualProjectSlug}.veryfront.com`
          : `https://${projectName}.veryfront.com`;
        console.log("  " + success("✓") + " Deployed to " + brand(deployedUrl));
      } catch (err) {
        console.log(
          "  " + error("✗") + " Deploy failed: " +
            (err instanceof Error ? err.message : String(err)),
        );
      }
      break;
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

// Global auto mode flag
let autoMode = false;

// Store actual slug after project creation (includes random suffix from newCommand)
let actualProjectSlug: string | null = null;

// Step timing tracking
interface StepTiming {
  startTime?: number;
  endTime?: number;
  duration?: number;
}
const stepTimings: Map<string, StepTiming> = new Map();

function startStepTiming(stepId: string): void {
  stepTimings.set(stepId, { startTime: Date.now() });
}

function endStepTiming(stepId: string): void {
  const timing = stepTimings.get(stepId);
  if (timing?.startTime) {
    timing.endTime = Date.now();
    timing.duration = timing.endTime - timing.startTime;
  }
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

    let icon: string;
    let label: string;

    if (i < currentStepIndex) {
      // Completed
      icon = success("✓");
      const durationText = duration ? dim(` (${formatDuration(duration)})`) : "";
      label = dim(step.title) + durationText;
    } else if (i === currentStepIndex) {
      // Current
      icon = brand("●");
      label = step.title;
    } else {
      // Pending
      icon = muted("○");
      label = muted(step.title);
    }

    lines.push(`  ${icon} ${label}`);
  }

  return lines.join("\n");
}

/**
 * Run the guided demo
 */
/**
 * Generate a random suffix for unique project names
 */
function generateRandomSuffix(): string {
  return Math.random().toString(36).substring(2, 8);
}

export async function demoCommand(options: DemoOptions = {}): Promise<void> {
  // Generate unique project name with random suffix to avoid conflicts
  const defaultProjectName = `demo-${generateRandomSuffix()}`;
  const { projectName = defaultProjectName, auto = false, loginMethod } = options;

  // Set global auto mode
  autoMode = auto;

  // Check TTY
  if (!isTTY()) {
    console.log("Demo requires an interactive terminal.");
    return;
  }

  write(HIDE_CURSOR);

  try {
    // Welcome screen - horizontal layout like Claude Code with spinner animation
    write(CLEAR_SCREEN + MOVE_HOME);
    console.log();

    // Create animated dot matrix for spinner
    const matrix = new AnimatedDotMatrix({ litColor: "\x1b[38;2;0;163;244m" });
    const textLines = [
      bold(brand("Veryfront")),
      muted("Interactive Demo" + (autoMode ? " (Auto Mode)" : "")),
    ];

    // Print initial frame (will be overwritten by animation)
    console.log(matrix.renderWithText(textLines));

    // Spin for 2 rounds, updating in place
    await matrix.spinRoundsWithText(2, textLines, (frame) => {
      // Move cursor up 7 lines (height of matrix) and redraw
      write(`${ESC}[7A`);
      console.log(frame);
    }, 60);

    console.log();

    // Animated welcome text
    write("  ");
    await typeLine("This guided tour will walk you through", { charDelay: 25 });
    write("  ");
    await typeLine("creating and deploying your first Veryfront app.", { charDelay: 25 });

    if (!(await waitForEnter("Press Enter to begin..."))) {
      return;
    }

    // Clear step timings for fresh run
    stepTimings.clear();

    // Run through steps
    const total = DEMO_STEPS.length;
    for (let i = 0; i < DEMO_STEPS.length; i++) {
      const step = DEMO_STEPS[i]!;

      // Start timing this step
      startStepTiming(step.id);

      // Display step with progress indicator
      await displayStep(step, i + 1, total, projectName);

      // Show progress indicator after step header
      console.log();
      console.log(dim("  ─────────────────────────────"));
      console.log();
      console.log(renderProgress(i, DEMO_STEPS));
      console.log();

      if (step.hasAction) {
        // Wait for Enter before executing
        if (!(await waitForEnter("Press Enter to run..."))) {
          return;
        }

        // Execute the action
        console.log();
        await executeStepAction(step, projectName, loginMethod);

        // End timing after action
        endStepTiming(step.id);

        // Wait for Enter after action (unless skipPostWait)
        if (!step.skipPostWait && i < DEMO_STEPS.length - 1) {
          if (!(await waitForEnter("Press Enter to continue..."))) {
            return;
          }
        }
      } else {
        // End timing for non-action steps
        endStepTiming(step.id);

        // No action - just wait for Enter to continue
        if (i < DEMO_STEPS.length - 1) {
          if (!(await waitForEnter("Press Enter to continue..."))) {
            return;
          }
        }
      }
    }

    // Completion screen - polished success banner
    write(CLEAR_SCREEN + MOVE_HOME);
    const finalUrl = actualProjectSlug
      ? `https://${actualProjectSlug}.veryfront.com`
      : `https://${projectName}.veryfront.com`;
    console.log();

    // Success banner with info
    console.log(successBanner("Demo Complete! Your app is live.", {
      url: finalUrl,
      project: actualProjectSlug || projectName,
    }));

    console.log();
    console.log("  " + bold("Next steps:"));
    console.log();
    console.log("  " + dim("1.") + " Edit your app in " + brand(`${projectName}/`));
    console.log("  " + dim("2.") + " Run " + brand("veryfront dev") + " to start developing");
    console.log("  " + dim("3.") + " Run " + brand("veryfront deploy") + " to publish changes");
    console.log();
    console.log("  " + dim("Learn more at https://veryfront.com/docs"));
    console.log();

    await waitForEnter("Press Enter to exit...");
  } finally {
    write(SHOW_CURSOR);
  }

  // Exit cleanly
  exitProcess(0);
}
