import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { Page } from "npm:playwright@1.60.0";
import {
  captureBrowserDiagnostics,
  getBrowserDiagnosticMessages,
  launchChromium,
} from "../../../tests/_helpers/playwright.ts";
import { MessageFromRendererSchema } from "../schemas/studio.schema.ts";
import { STUDIO_BRIDGE_BUNDLE } from "./bridge-bundle.generated.ts";

const STUDIO_ORIGIN = "http://localhost";
const STUDIO_URL = `${STUDIO_ORIGIN}/studio`;
const FIRST_PREVIEW_URL = `${STUDIO_ORIGIN}/preview-one`;

interface StudioMessage {
  action?: unknown;
  url?: unknown;
  [key: string]: unknown;
}

function parentDocument(): string {
  return `<!doctype html>
<html>
  <body>
    <iframe id="preview" src="/preview-one"></iframe>
    <script>
      globalThis.__studioMessages = [];
      globalThis.__previewLoadCount = 0;
      const preview = document.getElementById("preview");
      preview.addEventListener("load", () => globalThis.__previewLoadCount++);
      globalThis.addEventListener("message", (event) => {
        if (event.source === preview.contentWindow) {
          globalThis.__studioMessages.push(event.data);
        }
      });
    </script>
  </body>
</html>`;
}

function previewDocument(pageId: string): string {
  return `<!doctype html>
<html>
  <body>
    <main id="root"><h1 data-vf-text="true">${pageId}</h1></main>
    <script>
      globalThis.__VF_BRIDGE_CONFIG__ = {
        projectId: "browser-project",
        pageId: ${JSON.stringify(pageId)},
        pagePath: "app/page.tsx",
        nonce: ""
      };
    </script>
    <script type="module" src="/studio-bridge.js"></script>
  </body>
</html>`;
}

async function readStudioMessages(page: Page): Promise<StudioMessage[]> {
  return await page.evaluate(() => {
    const messages = (globalThis as typeof globalThis & {
      __studioMessages?: StudioMessage[];
    }).__studioMessages;
    return Array.isArray(messages) ? messages : [];
  });
}

async function establishStudioOrigin(page: Page): Promise<void> {
  await page.evaluate((origin) => {
    const preview = document.getElementById("preview");
    if (!(preview instanceof HTMLIFrameElement) || !preview.contentWindow) {
      throw new Error("Preview iframe is unavailable");
    }
    preview.contentWindow.postMessage({ action: "colorMode", value: "dark" }, origin);
  }, STUDIO_ORIGIN);
}

async function waitForTreeUpdate(page: Page, url: string): Promise<void> {
  try {
    await page.waitForFunction(
      (expectedUrl) => {
        const messages = (globalThis as typeof globalThis & {
          __studioMessages?: StudioMessage[];
        }).__studioMessages;
        return messages?.some((message) =>
          message.action === "treeUpdated" && message.url === expectedUrl
        );
      },
      url,
      { timeout: 5_000 },
    );
  } catch (error) {
    throw new Error(
      `Timed out waiting for treeUpdated at ${url}: ${
        JSON.stringify(await readStudioMessages(page))
      }`,
      { cause: error },
    );
  }
}

describe(
  "generated Studio bridge browser execution",
  { sanitizeOps: false, sanitizeResources: false },
  () => {
    it("delivers schema-valid lifecycle state after a trusted parent handshake", async () => {
      const browser = await launchChromium();
      if (!browser) return;

      const browserContext = await browser.newContext();
      const unexpectedRequests: string[] = [];

      try {
        await browserContext.route("**/*", async (route) => {
          const url = new URL(route.request().url());
          if (url.origin !== STUDIO_ORIGIN) {
            unexpectedRequests.push(url.href);
            await route.abort();
            return;
          }

          switch (url.pathname) {
            case "/studio":
              await route.fulfill({
                status: 200,
                contentType: "text/html; charset=utf-8",
                body: parentDocument(),
              });
              return;
            case "/preview-one":
              await route.fulfill({
                status: 200,
                contentType: "text/html; charset=utf-8",
                body: previewDocument("page-one"),
              });
              return;
            case "/studio-bridge.js":
              await route.fulfill({
                status: 200,
                contentType: "text/javascript; charset=utf-8",
                body: STUDIO_BRIDGE_BUNDLE,
              });
              return;
            default:
              unexpectedRequests.push(url.href);
              await route.abort();
          }
        });

        const page = await browserContext.newPage();
        const diagnostics = captureBrowserDiagnostics(page);

        const response = await page.goto(STUDIO_URL);
        assertEquals(response?.status(), 200);
        await page.waitForFunction(
          () =>
            (globalThis as typeof globalThis & { __previewLoadCount?: number })
              .__previewLoadCount === 1,
          undefined,
          { timeout: 5_000 },
        );

        assertEquals(await readStudioMessages(page), []);
        await establishStudioOrigin(page);
        await waitForTreeUpdate(page, FIRST_PREVIEW_URL);

        const firstMessages = await readStudioMessages(page);
        const firstLifecycle = firstMessages.filter((message) =>
          message.url === FIRST_PREVIEW_URL &&
          (message.action === "appLoaded" || message.action === "appUpdated" ||
            message.action === "onPageTransitionEnd")
        );
        assertEquals(
          firstLifecycle.map((message) => message.action),
          ["appLoaded", "appUpdated", "onPageTransitionEnd"],
        );
        for (const message of firstMessages) {
          const parsed = MessageFromRendererSchema.safeParse(message);
          assert(parsed.success, `Bridge emitted an invalid message: ${JSON.stringify(message)}`);
        }

        assertEquals(unexpectedRequests, []);
        assertEquals(getBrowserDiagnosticMessages(diagnostics), []);
      } finally {
        await browserContext.unrouteAll({ behavior: "ignoreErrors" });
        await browserContext.close();
        await browser.close();
      }
    });
  },
);
