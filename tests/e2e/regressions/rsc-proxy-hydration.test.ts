import { assertEquals } from "#veryfront/testing/assert";
import { afterAll, describe, it } from "#veryfront/testing/bdd";
import "../../_helpers/log-guard.ts";
import { join } from "#veryfront/compat/path";
import { mkdir, remove, writeTextFile } from "#veryfront/compat/fs.ts";
import { withTestContext } from "../../_helpers/context.ts";
import {
  collectBrowserErrors,
  getHydrationErrors,
  launchChromium,
} from "../../_helpers/playwright.ts";
import { cleanupBundler } from "../../../src/rendering/cleanup.ts";
import { startProductionServer } from "../../../src/server/production-server.ts";

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

async function writeClientCounterApp(
  projectDir: string,
  configSource: string,
): Promise<void> {
  await writeTextFile(join(projectDir, "veryfront.config.js"), configSource);

  await remove(join(projectDir, "app"), { recursive: true });
  await remove(join(projectDir, "pages"), { recursive: true });

  await mkdir(join(projectDir, "app"), { recursive: true });
  await writeTextFile(
    join(projectDir, "app", "layout.tsx"),
    `export default function RootLayout({ children }: { children: React.ReactNode }) {
            return <html><body>{children}</body></html>;
          }`,
  );
  await writeTextFile(
    join(projectDir, "app", "page.tsx"),
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
}

async function writePreviewChatApp(
  projectDir: string,
  configSource: string,
): Promise<void> {
  await writeTextFile(join(projectDir, "veryfront.config.js"), configSource);

  await remove(join(projectDir, "app"), { recursive: true });
  await remove(join(projectDir, "pages"), { recursive: true });

  await mkdir(join(projectDir, "app"), { recursive: true });
  await writeTextFile(
    join(projectDir, "app", "layout.tsx"),
    `export default function RootLayout({ children }: { children: React.ReactNode }) {
            return <html><body>{children}</body></html>;
          }`,
  );
  await writeTextFile(
    join(projectDir, "app", "page.tsx"),
    `"use client";
import * as React from "react";
import type { UIMessage } from "veryfront/agent/react";
import { Chat } from "veryfront/chat";

const initialMessages: UIMessage[] = [
  {
    id: "assistant-1",
    role: "assistant",
    metadata: {
      model: "anthropic/claude-sonnet-4-20250514",
    },
    parts: [
      {
        type: "text",
        text: "Styled preview assistant response",
      },
    ],
  },
];

export default function Page() {
  const [input, setInput] = React.useState("");

  return (
    <main id="preview-chat-page">
      <Chat
        messages={initialMessages}
        input={input}
        onChange={(event) => setInput(event.currentTarget.value)}
      />
    </main>
  );
}
`,
  );
}

async function assertCounterHydration(
  page: import("npm:playwright").Page,
  options: { expectedStrategy: string; expectedModulePath: string },
): Promise<void> {
  await page.waitForSelector('#counter[data-hydrated="yes"]');

  const initialText = await page.textContent("#counter");
  assertEquals(initialText?.trim(), "Count: 0");

  const hydrationData = JSON.parse(
    (await page.textContent("#veryfront-hydration-data")) ?? "{}",
  ) as { clientModuleStrategy?: string; pagePath?: string };
  assertEquals(hydrationData.clientModuleStrategy, options.expectedStrategy);
  assertEquals(hydrationData.pagePath, "app/page.tsx");

  await page.click("#counter");
  await page.waitForFunction(
    () => document.querySelector("#counter")?.textContent?.trim() === "Count: 1",
  );

  const hydratedText = await page.textContent("#counter");
  assertEquals(hydratedText?.trim(), "Count: 1");

  const resources = await page.evaluate(() =>
    performance.getEntriesByType("resource").map((entry) => entry.name)
  );
  assertEquals(
    resources.some((name) => name.includes(options.expectedModulePath)),
    true,
  );
}

async function assertPreviewChatStyling(
  page: import("npm:playwright").Page,
): Promise<void> {
  await page.waitForSelector("#preview-chat-page [data-vf-chat]");
  await page.locator('link#vf-tailwind-css[href*="/_vf_styles/styles.css"]').waitFor({
    state: "attached",
  });
  await page.waitForSelector('svg path[d^="M17.3041"]');

  const hydrationData = JSON.parse(
    (await page.textContent("#veryfront-hydration-data")) ?? "{}",
  ) as { clientModuleStrategy?: string; pagePath?: string };
  assertEquals(hydrationData.clientModuleStrategy, "fs");
  assertEquals(hydrationData.pagePath, "app/page.tsx");

  await page.fill('textarea[placeholder="Type a message..."]', "hydrated preview input");
  await page.waitForFunction(
    () =>
      (document.querySelector('textarea[placeholder="Type a message..."]') as
        | HTMLTextAreaElement
        | null)?.value === "hydrated preview input",
  );

  const previewState = await page.evaluate(() => {
    const stylesheet = document.querySelector("link#vf-tailwind-css") as HTMLLinkElement | null;
    const avatarPath = document.querySelector('svg path[d^="M17.3041"]');
    const avatarSvg = avatarPath?.closest("svg");
    const avatarBox = avatarSvg?.getBoundingClientRect();

    return {
      stylesheetHref: stylesheet?.getAttribute("href") ?? "",
      avatarWidth: avatarBox?.width ?? 0,
      avatarHeight: avatarBox?.height ?? 0,
    };
  });

  assertEquals(
    previewState.stylesheetHref.includes("/_vf_styles/styles.css"),
    true,
  );
  assertEquals(previewState.avatarWidth > 0 && previewState.avatarWidth <= 24, true);
  assertEquals(previewState.avatarHeight > 0 && previewState.avatarHeight <= 24, true);
}

describe(
  "RSC Hydration Browser Tests",
  { sanitizeOps: false, sanitizeResources: false },
  () => {
    afterAll(async () => {
      await cleanupBundler();
    });

    it("hydrates a local-production client page and becomes interactive", async () => {
      const browser = await launchChromium();
      if (!browser) return;

      try {
        await withTestContext("rsc-local-browser-hydration", async (context) => {
          await writeClientCounterApp(
            context.projectDir,
            `export default { experimental: { rsc: true } };`,
          );

          const server = await context.createProductionServer({ hostname: "127.0.0.1" });
          const browserContext = await browser.newContext();
          const page = await browserContext.newPage();
          const { consoleErrors, pageErrors } = collectBrowserErrors(page);

          try {
            const response = await page.goto(`http://127.0.0.1:${server.port}/`);
            assertEquals(response?.status(), 200);

            await assertCounterHydration(page, {
              expectedStrategy: "fs",
              expectedModulePath: "/_veryfront/fs/",
            });

            const hydrationErrors = getHydrationErrors([...consoleErrors, ...pageErrors]);
            assertEquals(hydrationErrors.length, 0);
          } finally {
            await browserContext.close();
          }
        });
      } finally {
        await browser.close();
      }
    });

    it("hydrates a remote-production client page and becomes interactive", async () => {
      const browser = await launchChromium();
      if (!browser) return;

      try {
        await withTestContext("rsc-proxy-browser-hydration", async (context) => {
          await writeClientCounterApp(
            context.projectDir,
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
          const { consoleErrors, pageErrors } = collectBrowserErrors(page);

          try {
            const response = await page.goto(`http://127.0.0.1:${port}/`);
            assertEquals(response?.status(), 200);

            await assertCounterHydration(page, {
              expectedStrategy: "rsc-module",
              expectedModulePath: "/_veryfront/rsc/module?",
            });

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

    it("keeps preview chat pages styled after hydration", async () => {
      const browser = await launchChromium();
      if (!browser) return;

      try {
        await withTestContext("rsc-preview-chat-browser-styling", async (context) => {
          await writePreviewChatApp(
            context.projectDir,
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
              "x-environment": "preview",
              "x-project-slug": "browser-preview-project",
              "x-release-id": "rel-browser-preview-test",
              "x-token": "test-token",
            },
          });
          const page = await browserContext.newPage();
          const { consoleErrors, pageErrors } = collectBrowserErrors(page);

          try {
            const response = await page.goto(`http://127.0.0.1:${port}/`);
            assertEquals(response?.status(), 200);

            await assertPreviewChatStyling(page);

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
