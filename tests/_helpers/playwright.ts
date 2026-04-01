import { type Browser, chromium, type Page } from "npm:playwright";

export function isMissingBrowserExecutable(error: unknown): boolean {
  return String(error).includes("Executable doesn't exist");
}

export async function launchChromium(): Promise<Browser | null> {
  try {
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

export function collectBrowserErrors(
  page: Page,
): { consoleErrors: string[]; pageErrors: string[] } {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];

  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => {
    pageErrors.push(error.message);
  });

  return { consoleErrors, pageErrors };
}

export function getHydrationErrors(messages: string[]): string[] {
  return messages.filter((message) =>
    message.includes("Page hydration failed") ||
    message.includes("unsafe-eval") ||
    message.includes("Failed to fetch dynamically imported module") ||
    message.includes("WebAssembly.compile()") ||
    message.includes("Hydration")
  );
}
