/**
 * Demo command - Interactive guided tour of Veryfront CLI
 *
 * @module cli/commands/demo
 */
import * as dntShim from "../../../../_dnt.shims.js";
import { chdir, cwd, promptSync, writeStdout } from "../../../platform/compat/process.js";
import { getStdinReader, setRawMode } from "../../../platform/compat/stdin.js";
import { join } from "../../../platform/compat/path/index.js";
import { bold, brand, dim, error, muted, success } from "../../ui/colors.js";
import { AnimatedDotMatrix } from "../../ui/dot-matrix.js";
import { HIDE_CURSOR, SHOW_CURSOR, typeCommand, typeLine } from "../../ui/animated-text.js";
import { successBanner } from "../../ui/components/banner.js";
import { formatDuration } from "../../ui/progress.js";
import { exitProcess, isTTY } from "../../utils/index.js";
import { readToken, saveToken, validateToken } from "../../auth/index.js";
import { canOpenBrowser, openBrowser } from "../../auth/browser.js";
import { getCallbackUrl, startCallbackServer } from "../../auth/callback-server.js";
import { DEFAULT_LOGIN_TIMEOUT_MS, getApiUrl } from "../../auth/constants.js";
import { newCommand } from "../new.js";
import { deployCommand } from "../deploy.js";
import { pushCommand } from "../push.js";
import { devCommand } from "../dev.js";
import { reserveProjectSlug } from "../new/reserve-slug.js";
import { readConfigFile } from "../../shared/config.js";
import { DEMO_STEPS } from "./steps.js";
// ANSI escape codes
const ESC = "\x1b";
const CLEAR_SCREEN = `${ESC}[2J`;
const MOVE_HOME = `${ESC}[H`;
function write(s) {
    writeStdout(s);
}
function delay(ms) {
    return new Promise((resolve) => dntShim.setTimeout(resolve, ms));
}
const AUTH_OPTIONS = [
    { id: "google", label: "Google" },
    { id: "github", label: "GitHub" },
    { id: "microsoft", label: "Microsoft" },
    { id: "token", label: "API Token" },
];
function clearCountdownLine() {
    write("\r  " + " ".repeat(30) + "\r");
}
async function countdown(message, seconds = 3) {
    for (let i = seconds; i > 0; i--) {
        write(`\r  ${muted(message(i))}`);
        await delay(1000);
    }
    clearCountdownLine();
}
function drawAuthOptions(selectedIndex) {
    for (let i = 0; i < AUTH_OPTIONS.length; i++) {
        const opt = AUTH_OPTIONS[i];
        if (i === selectedIndex) {
            console.log("  " + brand("❯") + " " + opt.label);
        }
        else {
            console.log("    " + muted(opt.label));
        }
    }
}
function redrawAuthOptions() {
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
async function demoLogin(preselectedMethod) {
    let method = preselectedMethod ?? null;
    const selectedIndex = method ? AUTH_OPTIONS.findIndex((o) => o.id === method) : 0;
    if (autoMode) {
        method ??= AUTH_OPTIONS[0].id;
        console.log();
        console.log("  " + dim("Choose authentication method:"));
        console.log();
        drawAuthOptions(selectedIndex);
        console.log();
        await countdown((i) => `Auto-selecting in ${i}...`);
    }
    else if (!method) {
        console.log();
        console.log("  " + dim("Choose authentication method:"));
        console.log();
        let currentIndex = 0;
        drawAuthOptions(currentIndex);
        setRawMode(true);
        const reader = getStdinReader();
        const dec = new TextDecoder();
        try {
            while (true) {
                const { value, done } = await reader.read();
                if (done)
                    return false;
                const key = dec.decode(value);
                if (key === "\x03")
                    return false;
                if (key === "\r" || key === "\n") {
                    method = AUTH_OPTIONS[currentIndex].id;
                    break;
                }
                if (key === "\x1b[A" || key === "k") {
                    currentIndex = Math.max(0, currentIndex - 1);
                }
                else if (key === "\x1b[B" || key === "j") {
                    currentIndex = Math.min(AUTH_OPTIONS.length - 1, currentIndex + 1);
                }
                else if (key >= "1" && key <= "4") {
                    method = AUTH_OPTIONS[parseInt(key) - 1]?.id ?? null;
                    if (method)
                        break;
                }
                redrawAuthOptions();
                drawAuthOptions(currentIndex);
            }
        }
        finally {
            reader.releaseLock();
            setRawMode(false);
        }
    }
    if (!method)
        return false;
    console.log();
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
    if (!canOpenBrowser()) {
        console.log("  " + error("Browser login not available in this environment."));
        return false;
    }
    console.log("  " + dim("Starting authentication server..."));
    let server;
    try {
        server = await startCallbackServer();
    }
    catch (e) {
        console.log("  " + error(`Failed to start server: ${e}`));
        return false;
    }
    const callbackUrl = getCallbackUrl(server.port);
    const authUrl = `${getApiUrl()}/auth/${method}?redirect_uri=${encodeURIComponent(callbackUrl)}`;
    console.log("  " + brand("Opening browser to log in..."));
    console.log();
    console.log("  " + dim("If the browser doesn't open, visit:"));
    console.log("  " + dim(authUrl));
    console.log();
    try {
        await openBrowser(authUrl);
    }
    catch {
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
    }
    catch (e) {
        console.log();
        console.log("  " + error("✗") + " " + (e instanceof Error ? e.message : String(e)));
        return false;
    }
    finally {
        await server.stop();
    }
}
/**
 * Wait for Enter key press or auto-advance after timeout
 * Returns false if Ctrl+C was pressed (cancel)
 */
async function waitForEnter(prompt) {
    if (autoMode) {
        console.log();
        await countdown((i) => `Auto-continuing in ${i}...`);
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
            if (done)
                return false;
            const key = dec.decode(value);
            if (key === "\x03")
                return false;
            if (key === "\r" || key === "\n")
                return true;
        }
    }
    finally {
        reader.releaseLock();
        setRawMode(false);
    }
}
/**
 * Display a single demo step with animated text
 */
async function displayStep(step, stepNum, total, projectName) {
    write(CLEAR_SCREEN + MOVE_HOME);
    console.log();
    console.log(`  ${muted(`[${stepNum}/${total}]`)} ${bold(brand(step.title))}`);
    console.log();
    for (const line of step.description) {
        write("  ");
        await typeLine(line, { charDelay: 20 });
    }
    if (!step.command)
        return;
    const displayCommand = step.command.replace("demo-app", projectName);
    console.log();
    await typeCommand(displayCommand, { charDelay: 40 });
}
/**
 * Execute the action for a step
 */
async function executeStepAction(step, projectName, loginMethod) {
    switch (step.id) {
        case "login": {
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
            await newCommand(projectName, { template: "ai", skipDeploy: true, force: true });
            const projectDir = join(cwd(), projectName);
            const config = await readConfigFile(projectDir);
            const actualSlug = config?.projectSlug;
            if (!actualSlug)
                break;
            actualProjectSlug = actualSlug;
            const token = await readToken();
            if (!token)
                break;
            console.log();
            console.log("  " + dim("Registering project..."));
            try {
                await reserveProjectSlug(actualSlug, token);
                console.log("  " + success("✓") + " Project registered");
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
            }
            catch (e) {
                console.log("  " + error("✗") + " " + (e instanceof Error ? e.message : String(e)));
            }
            break;
        }
        case "dev": {
            const projectDir = cwd();
            if (autoMode) {
                console.log();
                console.log("  " + dim("Skipping dev server in auto mode..."));
                console.log();
                console.log("  " + success("✓") + " Dev server skipped");
                break;
            }
            console.log();
            console.log("  " + dim("Starting dev server..."));
            try {
                const result = await devCommand({
                    port: 3000,
                    projectDir,
                    hmr: true,
                    demoMode: true,
                });
                await result.ready;
                console.log("  " + success("●") + " " + brand("http://localhost:3000/"));
                console.log();
                console.log("  " + dim("Opening browser..."));
                try {
                    await openBrowser("http://localhost:3000");
                }
                catch {
                    // Ignore if browser can't be opened
                }
                console.log();
                console.log("  " + dim("Press Enter to stop the dev server and continue..."));
                await waitForEnter();
                console.log();
                console.log("  " + dim("Stopping dev server..."));
                await result.stop();
                await result.done;
            }
            catch (e) {
                console.log("  " + error("✗") + " " + (e instanceof Error ? e.message : String(e)));
            }
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
                    quiet: true,
                    force: true,
                    dryRun: false,
                });
                const deployedUrl = `https://${(actualProjectSlug ?? projectName)}.veryfront.com`;
                console.log("  " + success("✓") + " Deployed to " + brand(deployedUrl));
            }
            catch (e) {
                console.log("  " + error("✗") + " Deploy failed: " +
                    (e instanceof Error ? e.message : String(e)));
            }
            break;
        }
    }
}
let autoMode = false;
let actualProjectSlug = null;
const stepTimings = new Map();
function startStepTiming(stepId) {
    stepTimings.set(stepId, { startTime: Date.now() });
}
function endStepTiming(stepId) {
    const timing = stepTimings.get(stepId);
    if (!timing?.startTime)
        return;
    timing.endTime = Date.now();
    timing.duration = timing.endTime - timing.startTime;
}
function getStepDuration(stepId) {
    return stepTimings.get(stepId)?.duration;
}
/**
 * Render a progress indicator showing all steps
 */
function renderProgress(currentStepIndex, steps) {
    const lines = [];
    for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
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
function generateRandomSuffix() {
    return Math.random().toString(36).substring(2, 8);
}
export async function demoCommand(options = {}) {
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
            muted("Interactive Demo" + (autoMode ? " (Auto Mode)" : "")),
        ];
        console.log(matrix.renderWithText(textLines));
        await matrix.spinRoundsWithText(2, textLines, (frame) => {
            write(`${ESC}[7A`);
            console.log(frame);
        }, 60);
        console.log();
        write("  ");
        await typeLine("This guided tour will walk you through", { charDelay: 25 });
        write("  ");
        await typeLine("creating and deploying your first Veryfront app.", { charDelay: 25 });
        if (!(await waitForEnter("Press Enter to begin...")))
            return;
        stepTimings.clear();
        const total = DEMO_STEPS.length;
        for (let i = 0; i < DEMO_STEPS.length; i++) {
            const step = DEMO_STEPS[i];
            startStepTiming(step.id);
            await displayStep(step, i + 1, total, projectName);
            console.log();
            console.log(dim("  ─────────────────────────────"));
            console.log();
            console.log(renderProgress(i, DEMO_STEPS));
            console.log();
            if (step.hasAction) {
                if (!(await waitForEnter("Press Enter to run...")))
                    return;
                console.log();
                await executeStepAction(step, projectName, loginMethod);
                endStepTiming(step.id);
                if (!step.skipPostWait && i < DEMO_STEPS.length - 1) {
                    if (!(await waitForEnter("Press Enter to continue...")))
                        return;
                }
                continue;
            }
            endStepTiming(step.id);
            if (i < DEMO_STEPS.length - 1) {
                if (!(await waitForEnter("Press Enter to continue...")))
                    return;
            }
        }
        write(CLEAR_SCREEN + MOVE_HOME);
        const finalUrl = `https://${(actualProjectSlug ?? projectName)}.veryfront.com`;
        console.log();
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
    }
    finally {
        write(SHOW_CURSOR);
    }
    exitProcess(0);
}
