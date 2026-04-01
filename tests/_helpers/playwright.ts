import type { Browser, ConsoleMessage, Page } from "npm:playwright";

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

export async function launchChromium(): Promise<Browser | null> {
  try {
    const { chromium } = await import("npm:playwright");
    return await chromium.launch({ headless: true });
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
