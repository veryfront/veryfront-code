import { registerTailwindExtension } from "../../../src/html/styles-builder/__tests__/css-processor-setup.ts";
import { assertEquals } from "#veryfront/testing/assert";
import { afterAll, describe, it } from "#veryfront/testing/bdd";
import "../../_helpers/log-guard.ts";
import { join } from "#veryfront/compat/path";
import { mkdir, remove, writeTextFile } from "#veryfront/compat/fs.ts";
import { withTestContext } from "../../_helpers/context.ts";
import {
  captureBrowserDiagnostics,
  findHydrationOrCspFailures,
  getBrowserDiagnosticMessages,
  launchChromium,
} from "../../_helpers/playwright.ts";
import { cleanupBundler } from "../../../src/rendering/cleanup.ts";
import { startProductionServer } from "../../../src/server/production-server.ts";
import { bootstrapProd } from "../../../src/server/bootstrap.ts";
import { runtime } from "#veryfront/platform/adapters/detect.ts";
import { validateVeryfrontConfig } from "#veryfront/config/schemas/index.ts";
import { DEPENDENCY_PINNING_ENV_FLAG } from "#veryfront/release-assets/constants.ts";
import { withEnv } from "#veryfront/testing";

const ROOT_LAYOUT_SOURCE =
  `export default function RootLayout({ children }: { children: React.ReactNode }) {
            return <html><body>{children}</body></html>;
          }`;

const FRAGMENT_LAYOUT_SOURCE =
  `export default function RootLayout({ children }: { children: React.ReactNode }) {
            return <main>{children}</main>;
          }`;

const LOCAL_RSC_CONFIG_SOURCE = `export default { experimental: { rsc: true } };`;

const PROXY_MODE_CONFIG_SOURCE = `export default {
            experimental: { rsc: true },
            fs: {
              type: "veryfront-api",
              veryfront: {
                proxyMode: true,
                apiBaseUrl: "https://api.veryfront.com"
              }
            }
          };`;

const TRUST_FORWARDED_HEADERS_ENV = "VERYFRONT_TRUST_FORWARDED_HEADERS";

interface TestProjectContext {
  projectDir: string;
  projectId: string;
  allocatePort: () => Promise<number>;
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

async function writeClientApp(
  projectDir: string,
  configSource: string,
  pageSource: string,
): Promise<void> {
  await writeTextFile(join(projectDir, "veryfront.config.js"), configSource);

  await remove(join(projectDir, "app"), { recursive: true });
  await remove(join(projectDir, "pages"), { recursive: true });

  await mkdir(join(projectDir, "app"), { recursive: true });
  await writeTextFile(join(projectDir, "app", "layout.tsx"), ROOT_LAYOUT_SOURCE);
  await writeTextFile(join(projectDir, "app", "page.tsx"), pageSource);
}

async function writeClientCounterApp(
  projectDir: string,
  configSource: string,
): Promise<void> {
  await writeClientApp(
    projectDir,
    configSource,
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

async function writeServerFragmentApp(
  projectDir: string,
  configSource: string,
): Promise<void> {
  await writeClientApp(
    projectDir,
    configSource,
    `export default function Page() {
  return <h1 id="server-page">Server page</h1>;
}
`,
  );
  await writeTextFile(join(projectDir, "app", "layout.tsx"), FRAGMENT_LAYOUT_SOURCE);
}

async function writePreviewChatApp(
  projectDir: string,
  configSource: string,
): Promise<void> {
  await writeClientApp(
    projectDir,
    configSource,
    `"use client";
import type { ChatMessage } from "veryfront/agent/react";
import { Chat } from "veryfront/chat";

const initialMessages: ChatMessage[] = [
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
  return (
    <main id="preview-chat-page">
      <Chat initialMessages={initialMessages} />
    </main>
  );
}
`,
  );
}

function getHostedHeaders(
  environment: "preview" | "production",
): Record<string, string> {
  return {
    "x-environment": environment,
    "x-project-slug": environment === "preview"
      ? "browser-preview-project"
      : "browser-proxy-project",
    "x-release-id": environment === "preview" ? "rel-browser-preview-test" : "rel-browser-test",
    "x-token": "test-token",
  };
}

async function withHostedBrowserPage(
  browser: import("npm:playwright").Browser,
  context: TestProjectContext,
  topology: "dedicated" | "shared",
  headers: Record<string, string>,
  run: (
    page: import("npm:playwright").Page,
    diagnostics: import("../../_helpers/playwright.ts").BrowserDiagnostics,
    response: import("npm:playwright").Response,
  ) => Promise<void>,
): Promise<void> {
  const environment = headers["x-environment"];
  let dedicatedEnvironment: "preview" | "production" | undefined;
  if (topology === "dedicated") {
    if (environment !== "preview" && environment !== "production") {
      throw new TypeError("Dedicated test runtimes require an explicit environment");
    }
    dedicatedEnvironment = environment;
  }

  const port = await context.allocatePort();
  const controller = new AbortController();
  const previousProxyTrust = Deno.env.get(TRUST_FORWARDED_HEADERS_ENV);
  Deno.env.set(TRUST_FORWARDED_HEADERS_ENV, "1");

  let server: Awaited<ReturnType<typeof startProductionServer>> | undefined;
  let disposeBootstrap: (() => void | Promise<void>) | undefined;

  try {
    await writeTextFile(
      join(context.projectDir, "veryfront.config.js"),
      LOCAL_RSC_CONFIG_SOURCE,
    );
    const adapter = await runtime.get();
    const bootstrap = await bootstrapProd(context.projectDir, adapter);
    disposeBootstrap = bootstrap.dispose;
    if (topology === "shared") {
      bootstrap.config = validateVeryfrontConfig({
        experimental: { rsc: true },
        fs: {
          type: "veryfront-api",
          veryfront: {
            proxyMode: true,
            apiBaseUrl: "https://api.veryfront.com",
          },
        },
      });
      await writeTextFile(
        join(context.projectDir, "veryfront.config.js"),
        PROXY_MODE_CONFIG_SOURCE,
      );
    }

    server = await startProductionServer({
      projectDir: context.projectDir,
      port,
      bindAddress: "127.0.0.1",
      signal: controller.signal,
      defaultProjectSlug: context.projectId,
      defaultProjectId: context.projectId,
      defaultEnvironment: dedicatedEnvironment,
      bootstrapResult: bootstrap,
    });
    await server.ready;
    await registerTailwindExtension();
    await waitForReady(port);

    // A dedicated runtime gets its environment and project identity from
    // host-owned startup options. Forwarded project headers belong only to the
    // shared topology explicitly trusted by the host-level proxy setting.
    const extraHTTPHeaders = topology === "shared" ? headers : undefined;
    const browserContext = await browser.newContext({ extraHTTPHeaders });
    await browserContext.addInitScript(() => {
      const testWindow = window as
        & typeof window
        & Record<string, unknown>
        & { __veryfrontTestHydrationState?: "complete" | "failed" };
      /** Records the runtime signal while preserving its original callback. */
      const observeSignal = (property: string, state: "complete" | "failed") => {
        let callback: ((...args: unknown[]) => unknown) | undefined;
        Object.defineProperty(testWindow, property, {
          configurable: true,
          get: () => callback,
          set: (value: unknown) => {
            if (typeof value !== "function") {
              callback = undefined;
              return;
            }
            const signal = value as (...args: unknown[]) => unknown;
            callback = function (this: unknown, ...args: unknown[]) {
              testWindow.__veryfrontTestHydrationState = state;
              return signal.apply(this, args);
            };
          },
        });
      };

      observeSignal("__veryfrontHydrationComplete", "complete");
      observeSignal("__veryfrontHydrationFailed", "failed");
    });
    await installEsmShCorsShim(browserContext);

    try {
      const page = await browserContext.newPage();
      const diagnostics = captureBrowserDiagnostics(page);
      const response = await page.goto(`http://127.0.0.1:${port}/`);
      if (!response) throw new Error("Browser navigation did not produce an HTTP response");
      await run(page, diagnostics, response);
    } finally {
      await browserContext.unrouteAll({ behavior: "ignoreErrors" });
      await browserContext.close();
    }
  } finally {
    controller.abort();
    await server?.stop();
    await disposeBootstrap?.();
    if (previousProxyTrust === undefined) {
      Deno.env.delete(TRUST_FORWARDED_HEADERS_ENV);
    } else {
      Deno.env.set(TRUST_FORWARDED_HEADERS_ENV, previousProxyTrust);
    }
  }
}

async function assertSharedRuntimeExecutionUnavailable(
  response: import("npm:playwright").Response,
): Promise<void> {
  assertEquals(response.status(), 503);
  assertEquals(response.headers()["cache-control"], "no-store");

  const problem = await response.json() as {
    type?: string;
    status?: number;
    detail?: string;
  };
  assertEquals(
    problem.type,
    "https://veryfront.com/docs/code/guides/errors#project-execution-unavailable",
  );
  assertEquals(problem.status, 503);
  assertEquals(problem.detail?.startsWith("Shared runtimes"), true);
}

async function installEsmShCorsShim(
  browserContext: import("npm:playwright").BrowserContext,
): Promise<void> {
  await browserContext.route("https://esm.sh/**", async (route) => {
    const request = route.request();
    const corsHeaders = {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET, HEAD, OPTIONS",
      "access-control-allow-headers": request.headers()["access-control-request-headers"] ?? "*",
    };

    try {
      if (request.method().toUpperCase() === "OPTIONS") {
        await route.fulfill({
          status: 204,
          headers: corsHeaders,
          body: "",
        });
        return;
      }

      const response = await route.fetch();
      await route.fulfill({
        response,
        headers: {
          ...response.headers(),
          ...corsHeaders,
        },
      });
    } catch (error) {
      if (isClosedRouteError(error)) {
        return;
      }
      throw error;
    }
  });
}

function isClosedRouteError(error: unknown): boolean {
  return error instanceof Error &&
    (error.message.includes("Target page, context or browser has been closed") ||
      error.message.includes("Route is already handled"));
}

async function assertCounterHydration(
  page: import("npm:playwright").Page,
  diagnostics: import("../../_helpers/playwright.ts").BrowserDiagnostics,
  options: { expectedStrategy: string; expectedModulePath: string },
): Promise<void> {
  try {
    await page.waitForSelector('#counter[data-hydrated="yes"]', {
      timeout: 60_000,
    });
  } catch (error) {
    const state = await page.evaluate(() => {
      const counter = document.querySelector("#counter");
      const hydrationData = document.querySelector("#veryfront-hydration-data");
      return {
        url: location.href,
        counterHtml: counter?.outerHTML ?? null,
        hydrationDataText: hydrationData?.textContent ?? null,
        scripts: [...document.scripts].map((script) => script.src).filter(Boolean),
        resources: performance.getEntriesByType("resource").map((entry) => entry.name),
      };
    });
    throw new Error(
      [
        "Counter did not hydrate before the timeout.",
        `Expected module path: ${options.expectedModulePath}`,
        `Page state: ${JSON.stringify(state, null, 2)}`,
        `Browser diagnostics: ${
          JSON.stringify(getBrowserDiagnosticMessages(diagnostics), null, 2)
        }`,
        `Original error: ${error instanceof Error ? error.message : String(error)}`,
      ].join("\n"),
    );
  }

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
  await page.locator('link#vf-project-css[href*="/_vf_styles/styles.css"]').waitFor({
    state: "attached",
  });
  await page.waitForSelector('svg path[d^="M17.3041"]');
  await page.waitForFunction(() => {
    const stylesheet = document.querySelector("link#vf-project-css") as HTMLLinkElement | null;
    const avatarPath = document.querySelector('svg path[d^="M17.3041"]');
    const avatarSvg = avatarPath?.closest("svg");
    const avatarBox = avatarSvg?.getBoundingClientRect();

    return Boolean(
      stylesheet?.sheet &&
        avatarBox &&
        avatarBox.width > 0 &&
        avatarBox.width <= 24 &&
        avatarBox.height > 0 &&
        avatarBox.height <= 24,
    );
  });

  const previewState = await page.evaluate(() => {
    const stylesheet = document.querySelector("link#vf-project-css") as HTMLLinkElement | null;
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
            LOCAL_RSC_CONFIG_SOURCE,
          );

          // Explicitly register the test project as local so the `fs`
          // client-module strategy and the `/_veryfront/fs/` module loader
          // are unlocked. Post-VULN-SRV-1/2 these strictly gate on
          // `isLocalProject`, and the test context writes its sources
          // outside of the `standardProjectDirs` (`data/projects/`,
          // `projects/`) discovery roots.
          const port = await context.allocatePort();
          const controller = new AbortController();
          const server = await startProductionServer({
            projectDir: context.projectDir,
            port,
            bindAddress: "127.0.0.1",
            signal: controller.signal,
            defaultProjectSlug: context.projectId,
            defaultProjectId: context.projectId,
            localProjects: { [context.projectId]: context.projectDir },
          });
          context.trackResource(server);
          await server.ready;
          await registerTailwindExtension();
          await waitForReady(port);

          const browserContext = await browser.newContext();
          const page = await browserContext.newPage();
          const diagnostics = captureBrowserDiagnostics(page);

          try {
            const response = await page.goto(`http://127.0.0.1:${port}/`);
            assertEquals(response?.status(), 200);

            await assertCounterHydration(page, diagnostics, {
              expectedStrategy: "fs",
              expectedModulePath: "/_veryfront/fs/",
            });

            const hydrationErrors = findHydrationOrCspFailures(
              getBrowserDiagnosticMessages(diagnostics),
            );
            assertEquals(hydrationErrors.length, 0);
          } finally {
            await browserContext.close();
          }
        });
      } finally {
        await browser.close();
      }
    });

    it("fails closed for production rendering in a shared runtime", async () => {
      const browser = await launchChromium();
      if (!browser) return;

      try {
        await withTestContext("rsc-shared-browser-boundary", async (context) => {
          await writeClientCounterApp(
            context.projectDir,
            PROXY_MODE_CONFIG_SOURCE,
          );

          await withHostedBrowserPage(
            browser,
            context,
            "shared",
            getHostedHeaders("production"),
            async (_page, _diagnostics, response) => {
              await assertSharedRuntimeExecutionUnavailable(response);
            },
          );
        });
      } finally {
        await browser.close();
      }
    });

    it("hydrates a dedicated production client page and becomes interactive", async () => {
      const browser = await launchChromium();
      if (!browser) return;

      try {
        await withTestContext("rsc-dedicated-browser-hydration", async (context) => {
          await writeClientCounterApp(
            context.projectDir,
            LOCAL_RSC_CONFIG_SOURCE,
          );

          await withHostedBrowserPage(
            browser,
            context,
            "dedicated",
            getHostedHeaders("production"),
            async (page, diagnostics, response) => {
              assertEquals(response.status(), 200);
              await assertCounterHydration(page, diagnostics, {
                expectedStrategy: "rsc-module",
                expectedModulePath: "/_veryfront/rsc/module?",
              });

              const hydrationErrors = findHydrationOrCspFailures(
                getBrowserDiagnosticMessages(diagnostics),
              );
              assertEquals(hydrationErrors.length, 0);
            },
          );
        });
      } finally {
        await browser.close();
      }
    });

    it("hydrates a dedicated preview client page and becomes interactive", async () => {
      const browser = await launchChromium();
      if (!browser) return;

      try {
        await withTestContext("rsc-dedicated-preview-hydration", async (context) => {
          await writeClientCounterApp(
            context.projectDir,
            LOCAL_RSC_CONFIG_SOURCE,
          );

          await withHostedBrowserPage(
            browser,
            context,
            "dedicated",
            getHostedHeaders("preview"),
            async (page, diagnostics, response) => {
              assertEquals(response.status(), 200);
              await assertCounterHydration(page, diagnostics, {
                expectedStrategy: "rsc-module",
                expectedModulePath: "/_veryfront/rsc/module?",
              });

              const hydrationErrors = findHydrationOrCspFailures(
                getBrowserDiagnosticMessages(diagnostics),
              );
              assertEquals(hydrationErrors.length, 0);
            },
          );
        });
      } finally {
        await browser.close();
      }
    });

    it("keeps a dedicated preview server page free of console errors", async () => {
      await withEnv({ [DEPENDENCY_PINNING_ENV_FLAG]: "1" }, async () => {
        const browser = await launchChromium();
        if (!browser) return;

        try {
          await withTestContext("rsc-dedicated-preview-server-page", async (context) => {
            await writeServerFragmentApp(
              context.projectDir,
              LOCAL_RSC_CONFIG_SOURCE,
            );

            await withHostedBrowserPage(
              browser,
              context,
              "dedicated",
              getHostedHeaders("preview"),
              async (page, diagnostics, response) => {
                assertEquals(response.status(), 200);
                await page.waitForFunction(() => {
                  const state = (window as typeof window & {
                    __veryfrontTestHydrationState?: string;
                  }).__veryfrontTestHydrationState;
                  return state === "complete" || state === "failed";
                });
                const hydrationState = await page.evaluate(() =>
                  (window as typeof window & {
                    __veryfrontTestHydrationState?: string;
                  }).__veryfrontTestHydrationState
                );
                assertEquals(hydrationState, "complete");
                assertEquals((await page.textContent("#server-page"))?.trim(), "Server page");

                const hydrationData = JSON.parse(
                  (await page.textContent("#veryfront-hydration-data")) ?? "{}",
                ) as {
                  clientModuleStrategy?: string;
                  dependencyPinningCacheKey?: string;
                  isolatedClientPage?: boolean;
                  pagePath?: string;
                };
                assertEquals(hydrationData.clientModuleStrategy, "rsc-module");
                assertEquals(hydrationData.dependencyPinningCacheKey?.startsWith("on:"), true);
                assertEquals(hydrationData.isolatedClientPage, undefined);
                assertEquals(hydrationData.pagePath, "app/page.tsx");

                const resources = await page.evaluate(() =>
                  performance.getEntriesByType("resource").map((entry) => entry.name)
                );
                assertEquals(
                  resources.some((url) =>
                    url.includes("/_veryfront/rsc/module?rel=app%2Fpage.tsx") ||
                    url.includes("/pages/index.js")
                  ),
                  false,
                );
                assertEquals(diagnostics.consoleMessages, []);
                assertEquals(diagnostics.pageErrors, []);
              },
            );
          });
        } finally {
          await browser.close();
        }
      });
    });

    it("keeps dedicated preview chat pages styled after hydration", async () => {
      const browser = await launchChromium();
      if (!browser) return;

      try {
        await withTestContext("rsc-preview-chat-browser-styling", async (context) => {
          await writePreviewChatApp(
            context.projectDir,
            LOCAL_RSC_CONFIG_SOURCE,
          );

          await withHostedBrowserPage(
            browser,
            context,
            "dedicated",
            getHostedHeaders("preview"),
            async (page, diagnostics, response) => {
              assertEquals(response.status(), 200);
              await assertPreviewChatStyling(page);

              const hydrationErrors = findHydrationOrCspFailures(
                getBrowserDiagnosticMessages(diagnostics),
              );
              assertEquals(hydrationErrors.length, 0);
            },
          );
        });
      } finally {
        await browser.close();
      }
    });
  },
);
