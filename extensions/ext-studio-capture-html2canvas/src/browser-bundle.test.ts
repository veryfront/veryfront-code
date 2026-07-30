import { assert, assertEquals } from "@std/assert";
import type { Page } from "npm:playwright@1.60.0";
import {
  captureBrowserDiagnostics,
  closeChromium,
  getBrowserDiagnosticMessages,
  launchChromium,
} from "../../../tests/_helpers/playwright.ts";
import { HTML2CANVAS_STUDIO_BRIDGE_BUNDLE } from "./studio-bridge-bundle.generated.ts";

const ORIGIN = "http://localhost";

interface StudioMessage {
  action?: unknown;
  requestId?: unknown;
  success?: unknown;
  data?: unknown;
  [key: string]: unknown;
}

function parentDocument(): string {
  return `<!doctype html>
<html>
  <body>
    <iframe id="preview" src="/preview"></iframe>
    <script>
      globalThis.__studioMessages = [];
      globalThis.__previewLoaded = false;
      const preview = document.getElementById("preview");
      preview.addEventListener("load", () => globalThis.__previewLoaded = true);
      globalThis.addEventListener("message", (event) => {
        if (event.source === preview.contentWindow) {
          globalThis.__studioMessages.push(event.data);
        }
      });
    </script>
  </body>
</html>`;
}

function previewDocument(): string {
  return `<!doctype html>
<html>
  <body>
    <main id="root"><h1 data-vf-text="true">extension capture</h1></main>
    <script>
      globalThis.__VF_BRIDGE_CONFIG__ = {
        projectId: "browser-project",
        pageId: "page-one",
        pagePath: "app/page.tsx",
        nonce: ""
      };
    </script>
    <script type="module" src="/studio-bridge.js"></script>
  </body>
</html>`;
}

async function readMessages(page: Page): Promise<StudioMessage[]> {
  return await page.evaluate(() => {
    const messages = (globalThis as typeof globalThis & {
      __studioMessages?: StudioMessage[];
    }).__studioMessages;
    return Array.isArray(messages) ? messages : [];
  });
}

Deno.test("html2canvas extension bundle composes working Studio capture", async () => {
  const browser = await launchChromium();
  if (!browser) return;

  const context = await browser.newContext();
  const unexpectedRequests: string[] = [];
  try {
    await context.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      if (url.origin !== ORIGIN) {
        unexpectedRequests.push(url.href);
        await route.abort();
        return;
      }
      if (url.pathname === "/studio") {
        await route.fulfill({
          status: 200,
          contentType: "text/html; charset=utf-8",
          body: parentDocument(),
        });
        return;
      }
      if (url.pathname === "/preview") {
        await route.fulfill({
          status: 200,
          contentType: "text/html; charset=utf-8",
          body: previewDocument(),
        });
        return;
      }
      if (url.pathname === "/studio-bridge.js") {
        await route.fulfill({
          status: 200,
          contentType: "text/javascript; charset=utf-8",
          body: HTML2CANVAS_STUDIO_BRIDGE_BUNDLE,
        });
        return;
      }
      unexpectedRequests.push(url.href);
      await route.abort();
    });

    const page = await context.newPage();
    const diagnostics = captureBrowserDiagnostics(page);
    assertEquals((await page.goto(`${ORIGIN}/studio`))?.status(), 200);
    await page.waitForFunction(
      () =>
        (globalThis as typeof globalThis & { __previewLoaded?: boolean })
          .__previewLoaded === true,
      undefined,
      { timeout: 5_000 },
    );

    await page.evaluate((origin) => {
      const preview = document.getElementById("preview");
      if (!(preview instanceof HTMLIFrameElement) || !preview.contentWindow) {
        throw new Error("Preview iframe is unavailable");
      }
      preview.contentWindow.postMessage({ action: "colorMode", value: "dark" }, origin);
      preview.contentWindow.postMessage(
        { action: "screenshot", requestId: "extension-capture" },
        origin,
      );
    }, ORIGIN);

    await page.waitForFunction(
      () => {
        const messages = (globalThis as typeof globalThis & {
          __studioMessages?: StudioMessage[];
        }).__studioMessages;
        return messages?.some((message) =>
          message.action === "screenshotResult" &&
          message.requestId === "extension-capture"
        );
      },
      undefined,
      { timeout: 10_000 },
    );

    const screenshot = (await readMessages(page)).find((message) =>
      message.action === "screenshotResult" && message.requestId === "extension-capture"
    );
    assertEquals(screenshot?.success, true);
    assert(
      typeof screenshot?.data === "string" &&
        screenshot.data.startsWith("data:image/png;base64,"),
    );
    assertEquals(unexpectedRequests, []);
    assertEquals(getBrowserDiagnosticMessages(diagnostics), []);
  } finally {
    await context.unrouteAll({ behavior: "ignoreErrors" });
    await context.close();
    await closeChromium(browser);
  }
});
