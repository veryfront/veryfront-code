import "#veryfront/schemas/_test-setup.ts";

import { assertEquals } from "#veryfront/testing/assert.ts";
import { createMockAdapter } from "#veryfront/platform/adapters/mock.ts";
import { createDevUiAssetProvider } from "#veryfront/extensions/dev-ui";
import { recordRequestPeerFromTransport } from "#veryfront/platform/adapters/runtime/shared/request-peer.ts";
import { createVeryfrontHandler } from "./index.ts";

Deno.test("runtime dashboard preserves trusted peers and rejects forged local Host peers", async () => {
  const projectDir = "/project";
  const handler = createVeryfrontHandler(projectDir, createMockAdapter(), {
    projectDir,
    config: {},
    defaultProjectSlug: "demo",
    localProjects: { demo: projectDir },
    devUiAssetProvider: createDevUiAssetProvider("globalThis.__dashboard = true;"),
  });

  try {
    await handler.ready;
    const localRequest = new Request("http://demo.veryfront.me/_dev", {
      headers: { host: "demo.veryfront.me" },
    });
    recordRequestPeerFromTransport(localRequest, {
      runtime: "deno",
      transport: "tcp",
      hostname: "::1",
    });

    const localResponse = await handler(localRequest);

    assertEquals(localResponse.status, 200);
    assertEquals(localResponse.headers.get("cache-control"), "no-store");
    assertEquals(localResponse.headers.has("set-cookie"), true);
    await localResponse.body?.cancel();

    let cancelled = false;
    const cancellationNeverSettles = new Promise<void>(() => {});
    const forgedRequest = new Request("http://demo.veryfront.me/_dev/api/hmr-trigger", {
      method: "POST",
      headers: { host: "demo.veryfront.me" },
      body: new ReadableStream<Uint8Array>({
        cancel() {
          cancelled = true;
          return cancellationNeverSettles;
        },
      }),
    });
    recordRequestPeerFromTransport(forgedRequest, {
      runtime: "deno",
      transport: "tcp",
      hostname: "192.168.1.25",
    });

    const forgedResponse = await handler(forgedRequest);

    assertEquals(forgedResponse.status, 403);
    assertEquals(forgedResponse.headers.get("cache-control"), "no-store");
    assertEquals(forgedResponse.headers.has("set-cookie"), false);
    assertEquals(cancelled, true);
  } finally {
    await handler.dispose();
  }
});
