import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { afterAll, describe, it } from "#veryfront/testing/bdd.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { loadMiddlewareFile } from "./middleware.ts";

function createVirtualAdapter(source: string): RuntimeAdapter {
  const fs = {
    getUnderlyingAdapter: () => fs,
    getAdapterType: () => "MultiProjectFSAdapter",
    isVeryfrontAdapter: () => true,
    isMultiProjectMode: () => true,
    exists: (path: string) => Promise.resolve(path.endsWith("/middleware.ts")),
    readFile: () => Promise.resolve(source),
  } as unknown as RuntimeAdapter["fs"];

  return {
    id: "test",
    name: "test",
    capabilities: {},
    fs,
    env: {
      get: () => undefined,
      set: () => {},
      delete: () => {},
      has: () => false,
      toObject: () => ({}),
    },
    server: {} as RuntimeAdapter["server"],
    serve: () => Promise.resolve({ close: () => Promise.resolve() }),
  } as unknown as RuntimeAdapter;
}

describe("loadMiddlewareFile", () => {
  afterAll(async () => {
    const { stop } = await import("veryfront/extensions/bundler");
    await stop();
  });

  it("fails closed for invalid production middleware", async () => {
    const adapter = createVirtualAdapter("export default function broken( {");

    await assertRejects(
      () => loadMiddlewareFile("/app", adapter, { throwOnError: true }),
      Error,
    );
  });

  it("fails closed when production middleware has no valid default export", async () => {
    const adapter = createVirtualAdapter("export const middleware = () => new Response('ok');");

    await assertRejects(
      () => loadMiddlewareFile("/app", adapter, { throwOnError: true }),
      TypeError,
      "Invalid middleware export",
    );
  });

  it("fails closed when a production middleware array contains invalid entries", async () => {
    const adapter = createVirtualAdapter(
      "export default [() => new Response('ok'), 'invalid'];",
    );

    await assertRejects(
      () => loadMiddlewareFile("/app", adapter, { throwOnError: true }),
      TypeError,
      "Invalid middleware export",
    );
  });

  it("preserves nonfatal development loading for invalid middleware", async () => {
    const adapter = createVirtualAdapter("export default function broken( {");

    assertEquals(await loadMiddlewareFile("/app", adapter), []);
  });
});
