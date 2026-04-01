import { assertEquals } from "#veryfront/testing/assert";
import { afterAll, describe, it } from "#veryfront/testing/bdd";
import "../../_helpers/log-guard.ts";
import { join } from "#veryfront/compat/path";
import { mkdir, remove, writeTextFile } from "#veryfront/compat/fs.ts";
import { withTestContext } from "../../_helpers/context.ts";
import { cleanupBundler } from "../../../src/rendering/cleanup.ts";
import { startProductionServer } from "../../../src/server/production-server.ts";
import { type Browser, chromium } from "npm:playwright";

function isMissingBrowserExecutable(error: unknown): boolean {
  return String(error).includes("Executable doesn't exist");
}

async function launchChromium(): Promise<Browser | null> {
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

async function waitForReady(port: number, timeoutMs = 5000): Promise<void> {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/readyz`);
      try {
        if (response.status === 200) return;
      } finally {
        await response.body?.cancel();
      }
    } catch {
      // server is still starting
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error("Server reported not-ready via /readyz");
}

function getHydrationErrors(messages: string[]): string[] {
  return messages.filter((message) =>
    message.includes("Page hydration failed") ||
    message.includes("unsafe-eval") ||
    message.includes("Failed to fetch dynamically imported module") ||
    message.includes("WebAssembly.compile()") ||
    message.includes("Hydration")
  );
}

describe(
  "RSC Proxy Hydration Browser Tests",
  { sanitizeOps: false, sanitizeResources: false },
  () => {
    afterAll(async () => {
      await cleanupBundler();
    });

    it("hydrates a remote-production client page and becomes interactive", async () => {
      const browser = await launchChromium();
      if (!browser) return;

      try {
        await withTestContext("rsc-proxy-browser-hydration", async (context) => {
          await writeTextFile(
            join(context.projectDir, "veryfront.config.js"),
            `export default {
            experimental: { rsc: true },
            fs: {
              veryfront: {
                proxyMode: true,
                apiBaseUrl: "https://api.veryfront.com"
              }
            }
          };`,
          );

          await remove(join(context.projectDir, "app"), { recursive: true });
          await remove(join(context.projectDir, "pages"), { recursive: true });

          await mkdir(join(context.projectDir, "app"), { recursive: true });
          await writeTextFile(
            join(context.projectDir, "app", "layout.tsx"),
            `export default function RootLayout({ children }: { children: React.ReactNode }) {
            return <html><body>{children}</body></html>;
          }`,
          );
          await writeTextFile(
            join(context.projectDir, "app", "page.tsx"),
            `"use client";
import { useEffect, useState } from "react";

export default function Page() {
  const [count, setCount] = useState(0);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setHydrated(true);
  }, []);

  return (
    <button
      id="counter"
      data-hydrated={hydrated ? "yes" : "no"}
      onClick={() => setCount((value) => value + 1)}
    >
      Count: {count}
    </button>
  );
}
`,
          );

          const port = await context.allocatePort();
          const controller = new AbortController();
          const server = await startProductionServer({
            projectDir: context.projectDir,
            port,
            bindAddress: "127.0.0.1",
            signal: controller.signal,
            defaultProjectSlug: context.projectId,
            defaultProjectId: context.projectId,
          });
          await server.ready;
          await waitForReady(port);
          const browserContext = await browser.newContext({
            extraHTTPHeaders: {
              "x-environment": "production",
              "x-project-slug": "browser-proxy-project",
              "x-release-id": "rel-browser-test",
              "x-token": "test-token",
            },
          });
          const page = await browserContext.newPage();
          const consoleErrors: string[] = [];
          const pageErrors: string[] = [];

          page.on("console", (message) => {
            if (message.type() === "error") consoleErrors.push(message.text());
          });
          page.on("pageerror", (error) => {
            pageErrors.push(error.message);
          });

          try {
            const response = await page.goto(`http://127.0.0.1:${port}/`);
            assertEquals(response?.status(), 200);

            await page.waitForSelector('#counter[data-hydrated="yes"]');

            const initialText = await page.textContent("#counter");
            assertEquals(initialText?.trim(), "Count: 0");

            const hydrationData = JSON.parse(
              (await page.textContent("#veryfront-hydration-data")) ?? "{}",
            ) as { clientModuleStrategy?: string; pagePath?: string };
            assertEquals(hydrationData.clientModuleStrategy, "rsc-module");
            assertEquals(hydrationData.pagePath, "app/page.tsx");

            await page.click("#counter");
            await page.waitForFunction(
              () => document.querySelector("#counter")?.textContent?.trim() === "Count: 1",
            );

            const hydratedText = await page.textContent("#counter");
            assertEquals(hydratedText?.trim(), "Count: 1");

            const hydrationErrors = getHydrationErrors([...consoleErrors, ...pageErrors]);
            assertEquals(hydrationErrors.length, 0);
          } finally {
            await browserContext.close();
            controller.abort();
            await server.stop();
          }
        });
      } finally {
        await browser.close();
      }
    });
  },
);
