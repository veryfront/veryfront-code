import type { Browser, ConsoleMessage, Page } from "npm:playwright@1.60.0";
import { fromFileUrl } from "#veryfront/compat/path/index.ts";

export interface BrowserDiagnostics {
  consoleMessages: string[];
  pageErrors: string[];
}

const HYDRATION_OR_CSP_FAILURE_PATTERNS = [
  "Page hydration failed",
  "unsafe-eval",
  "Failed to fetch dynamically imported module",
  "WebAssembly.compile()",
  "Content Security Policy",
  "violates the following Content Security Policy directive",
  "Refused to load the script",
  "Hydration",
] as const;

export function isMissingBrowserExecutable(error: unknown): boolean {
  return String(error).includes("Executable doesn't exist");
}

export const CHROMIUM_LAUNCH_TIMEOUT_MS = 15_000;

interface ChromiumLauncher {
  launch(options: { headless: boolean; timeout: number }): Promise<Browser>;
}

interface ChromiumConnector {
  connect(wsEndpoint: string, options: { timeout: number }): Promise<Browser>;
}

interface BrowserBridgeMessage {
  wsEndpoint: string;
}

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
  reader: ReadableStreamDefaultReader<Uint8Array>,
): Promise<BrowserBridgeMessage> {
  const decoder = new TextDecoder();
  let output = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) throw new Error("Playwright browser bridge exited before reporting an endpoint");
    output += decoder.decode(value, { stream: true });
    const newline = output.indexOf("\n");
    if (newline >= 0) return parseBrowserBridgeMessage(output.slice(0, newline));
  }
}

const browserBridgeCleanup = new WeakMap<Browser, () => Promise<void>>();

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

async function launchChromiumThroughNode(chromium: ChromiumConnector): Promise<Browser> {
  const bridgePath = fromFileUrl(new URL("./playwright-node-bridge.mjs", import.meta.url));
  const child = new Deno.Command("node", {
    args: [bridgePath],
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
  }).spawn();
  const stdoutReader = child.stdout.getReader();
  const stderrPromise = new Response(child.stderr).text();
  const statusPromise = child.status;
  let cleanupPromise: Promise<void> | null = null;

  const closeBridge = (): Promise<void> => {
    cleanupPromise ??= (async () => {
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
          // The bridge may already have exited.
        }
      }

      try {
        await withTimeout(
          statusPromise,
          CHROMIUM_LAUNCH_TIMEOUT_MS,
          "Playwright browser bridge did not exit after its input closed",
        );
      } catch (error) {
        try {
          child.kill("SIGKILL");
        } catch {
          // The bridge may have exited between the timeout and the signal.
        }
        await statusPromise;
        throw error;
      } finally {
        await stderrPromise;
      }
    })();
    return cleanupPromise;
  };

  try {
    const bridge = await withTimeout(
      Promise.race([
        readBrowserBridgeMessage(stdoutReader),
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
    await stdoutReader.cancel();
    stdoutReader.releaseLock();
    const browser = await chromium.connect(bridge.wsEndpoint, {
      timeout: CHROMIUM_LAUNCH_TIMEOUT_MS,
    });
    browserBridgeCleanup.set(browser, closeBridge);
    browser.on("disconnected", () => {
      void closeBridge();
    });

    return browser;
  } catch (error) {
    try {
      await stdoutReader.cancel();
    } catch {
      // The stream may already have closed with the child.
    }
    stdoutReader.releaseLock();
    try {
      child.kill("SIGTERM");
    } catch {
      // The bridge may already have exited.
    }
    await statusPromise;
    await stderrPromise;
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
  const { chromium } = await import("npm:playwright@1.60.0");
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

/** Close Chromium and await the Node bridge process when one owns the browser. */
export async function closeChromium(browser: Browser): Promise<void> {
  let browserError: unknown;
  try {
    await browser.close();
  } catch (error) {
    browserError = error;
  }

  let bridgeError: unknown;
  try {
    await browserBridgeCleanup.get(browser)?.();
  } catch (error) {
    bridgeError = error;
  } finally {
    browserBridgeCleanup.delete(browser);
  }

  if (browserError !== undefined && bridgeError !== undefined) {
    throw new AggregateError(
      [browserError, bridgeError],
      "Failed to close Chromium and its browser bridge",
    );
  }
  if (browserError !== undefined) throw browserError;
  if (bridgeError !== undefined) throw bridgeError;
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

export function findHydrationOrCspFailures(messages: string[]): string[] {
  return messages.filter((message) =>
    HYDRATION_OR_CSP_FAILURE_PATTERNS.some((pattern) => message.includes(pattern))
  );
}
