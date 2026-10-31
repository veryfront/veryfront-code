import type {
  Browser,
  ConsoleMessage,
  Page,
  Request,
  Response as PlaywrightResponse,
} from "npm:playwright@1.61.1";
import { fromFileUrl } from "#veryfront/compat/path/index.ts";
export { findHydrationOrCspFailures } from "../../src/testing/browser-diagnostics.mjs";

export interface BrowserDiagnostics {
  consoleMessages: string[];
  pageErrors: string[];
}

export function isMissingBrowserExecutable(error: unknown): boolean {
  return String(error).includes("Executable doesn't exist");
}

export const CHROMIUM_LAUNCH_TIMEOUT_MS = 15_000;
const BROWSER_BRIDGE_SHUTDOWN_TIMEOUT_MS = 1_000;

interface ChromiumLauncher {
  launch(options: { headless: boolean; timeout: number }): Promise<Browser>;
}

interface ChromiumConnector {
  connect(wsEndpoint: string, options: { timeout: number }): Promise<Browser>;
}

interface BrowserBridgeMessage {
  wsEndpoint: string;
}

interface BrowserBridgeProcess {
  stdin: WritableStream<Uint8Array>;
  kill(signal: Deno.Signal): void;
}

const browserBridgeCleanups = new WeakMap<Browser, () => Promise<void>>();

export function parseBrowserBridgeMessage(message: string): BrowserBridgeMessage {
  let parsed: unknown;
  try {
    parsed = JSON.parse(message);
  } catch {
    throw new Error("Playwright browser bridge returned invalid JSON");
  }

  if (
    !parsed || typeof parsed !== "object" ||
    !("wsEndpoint" in parsed) || typeof parsed.wsEndpoint !== "string" ||
    !parsed.wsEndpoint.startsWith("ws://")
  ) {
    throw new Error("Playwright browser bridge returned an invalid WebSocket endpoint");
  }

  return { wsEndpoint: parsed.wsEndpoint };
}

async function readBrowserBridgeMessage(
  stdout: ReadableStream<Uint8Array>,
): Promise<BrowserBridgeMessage> {
  const reader = stdout.getReader();
  const decoder = new TextDecoder();
  let output = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) throw new Error("Playwright browser bridge exited before reporting an endpoint");
      output += decoder.decode(value, { stream: true });
      const newline = output.indexOf("\n");
      if (newline >= 0) return parseBrowserBridgeMessage(output.slice(0, newline));
    }
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

/** @internal Exported for deterministic bridge-cleanup regression coverage. */
export async function cleanupBrowserBridgeProcess(
  child: BrowserBridgeProcess,
  statusPromise: Promise<Deno.CommandStatus>,
  stderrPromise: Promise<string>,
  timeoutMs = BROWSER_BRIDGE_SHUTDOWN_TIMEOUT_MS,
): Promise<void> {
  try {
    const writer = child.stdin.getWriter();
    try {
      await writer.close();
    } finally {
      writer.releaseLock();
    }
  } catch {
    try {
      child.kill("SIGTERM");
    } catch {
      /* expected: bridge may already have exited */
    }
  }

  try {
    await withTimeout(
      Promise.allSettled([statusPromise, stderrPromise]),
      timeoutMs,
      `Playwright browser bridge did not exit within ${timeoutMs}ms`,
    );
    return;
  } catch {
    try {
      child.kill("SIGKILL");
    } catch {
      /* expected: bridge may have exited as the timeout fired */
    }
  }

  await Promise.allSettled([
    withTimeout(
      statusPromise,
      timeoutMs,
      `Playwright browser bridge did not report exit after SIGKILL within ${timeoutMs}ms`,
    ),
    withTimeout(
      stderrPromise,
      timeoutMs,
      `Playwright browser bridge stderr did not close after SIGKILL within ${timeoutMs}ms`,
    ),
  ]);
}

async function launchChromiumThroughNode(chromium: ChromiumConnector): Promise<Browser> {
  const bridgePath = fromFileUrl(new URL("./playwright-node-bridge.mjs", import.meta.url));
  const child = new Deno.Command("node", {
    args: [bridgePath],
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
  }).spawn();
  const statusPromise = child.status;
  const stderrPromise = new Response(child.stderr).text();
  let cleanupPromise: Promise<void> | undefined;
  const cleanup = (): Promise<void> => {
    cleanupPromise ??= cleanupBrowserBridgeProcess(child, statusPromise, stderrPromise);
    return cleanupPromise;
  };

  try {
    const bridge = await withTimeout(
      Promise.race([
        readBrowserBridgeMessage(child.stdout),
        statusPromise.then(async (status) => {
          const stderr = (await stderrPromise).trim();
          throw new Error(
            `Playwright browser bridge exited with code ${status.code}${
              stderr ? `: ${stderr}` : ""
            }`,
          );
        }),
      ]),
      CHROMIUM_LAUNCH_TIMEOUT_MS,
      `Playwright browser bridge timed out after ${CHROMIUM_LAUNCH_TIMEOUT_MS}ms`,
    );
    const browser = await chromium.connect(bridge.wsEndpoint, {
      timeout: CHROMIUM_LAUNCH_TIMEOUT_MS,
    });

    browserBridgeCleanups.set(browser, cleanup);
    browser.on("disconnected", () => {
      void cleanup();
    });

    return browser;
  } catch (error) {
    await cleanup();
    throw error;
  }
}

export async function launchChromiumWith(chromium: ChromiumLauncher): Promise<Browser | null> {
  try {
    return await chromium.launch({
      headless: true,
      timeout: CHROMIUM_LAUNCH_TIMEOUT_MS,
    });
  } catch (error) {
    if (isMissingBrowserExecutable(error)) {
      console.warn(
        "SKIP: Playwright Chromium is not installed. Run `deno run -A npm:playwright install chromium`.",
      );
      return null;
    }

    throw error;
  }
}

export async function launchChromium(): Promise<Browser | null> {
  const { chromium } = await import("npm:playwright@1.61.1");
  try {
    return await launchChromiumThroughNode(chromium);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return await launchChromiumWith(chromium);
    }
    if (isMissingBrowserExecutable(error)) {
      console.warn(
        "SKIP: Playwright Chromium is not installed. Run `deno run -A npm:playwright install chromium`.",
      );
      return null;
    }
    throw error;
  }
}

/** Close a browser and await any Node bridge subprocess cleanup. */
export async function closeChromium(browser: Browser | null): Promise<void> {
  if (!browser) return;
  const cleanup = browserBridgeCleanups.get(browser);
  try {
    await browser.close();
  } finally {
    await cleanup?.();
    browserBridgeCleanups.delete(browser);
  }
}

export function captureBrowserDiagnostics(page: Page): BrowserDiagnostics {
  const consoleMessages: string[] = [];
  const pageErrors: string[] = [];

  page.on("console", (message: ConsoleMessage) => {
    if (message.type() === "error" || message.type() === "warning") {
      consoleMessages.push(message.text());
    }
  });
  page.on("pageerror", (error) => {
    pageErrors.push(error.message);
  });

  return { consoleMessages, pageErrors };
}

export function getBrowserDiagnosticMessages(diagnostics: BrowserDiagnostics): string[] {
  return [...diagnostics.consoleMessages, ...diagnostics.pageErrors];
}

/** Preserve default navigation semantics while retaining failed-load evidence. */
export async function navigateBrowserPage(
  page: Page,
  url: string,
  diagnostics: BrowserDiagnostics,
  serverLogs: string[],
): Promise<PlaywrightResponse | null> {
  const pending = new Set<Request>();
  const responses: { url: string; status: number }[] = [];
  const failed: { url: string; error: string | undefined }[] = [];
  const onRequest = (request: Request) => {
    if (pending.size < 100) pending.add(request);
  };
  const onFinished = (request: Request) => pending.delete(request);
  const onResponse = (response: PlaywrightResponse) => {
    if (responses.length < 100) {
      responses.push({ url: response.url().slice(0, 2048), status: response.status() });
    }
  };
  const onFailed = (request: Request) => {
    pending.delete(request);
    if (failed.length < 100) {
      failed.push({ url: request.url().slice(0, 2048), error: request.failure()?.errorText });
    }
  };
  page.on("request", onRequest);
  page.on("requestfinished", onFinished);
  page.on("response", onResponse);
  page.on("requestfailed", onFailed);
  try {
    return await page.goto(url);
  } catch (cause) {
    let documentState: unknown;
    try {
      documentState = await withTimeout(
        page.evaluate(() => ({
          url: location.href,
          readyState: document.readyState,
          html: document.documentElement.outerHTML.slice(0, 8000),
        })),
        1000,
        "Document diagnostics unavailable within 1000ms",
      );
    } catch (error) {
      documentState = { unavailable: String(error) };
    }
    throw new Error(
      `${String(cause)}\nNavigation diagnostics:\n${
        JSON.stringify(
          {
            pending: [...pending].map((request) => request.url().slice(0, 2048)),
            responses,
            failed,
            document: documentState,
            console: diagnostics.consoleMessages.slice(-50).map((message) =>
              message.slice(0, 2000)
            ),
            pageErrors: diagnostics.pageErrors.slice(-50).map((message) => message.slice(0, 2000)),
            serverLogs: serverLogs.join("\n").slice(-8000),
          },
          null,
          2,
        )
      }`,
      { cause },
    );
  } finally {
    page.off("request", onRequest);
    page.off("requestfinished", onFinished);
    page.off("response", onResponse);
    page.off("requestfailed", onFailed);
  }
}
