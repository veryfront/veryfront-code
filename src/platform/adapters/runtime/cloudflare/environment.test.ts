import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { CloudflareEnvironmentAdapter } from "./environment.ts";

interface WranglerStyleEnv {
  MODE: string;
  VERSION: string;
  SERVICE: { fetch(request: Request): Promise<Response> };
}

describe("CloudflareEnvironmentAdapter", () => {
  it("reads string bindings and excludes non-string bindings", () => {
    const adapter = new CloudflareEnvironmentAdapter({
      MODE: "production",
      KV: { get: () => Promise.resolve(null) },
    });

    assertEquals(adapter.get("MODE"), "production");
    assertEquals(adapter.get("KV"), undefined);
    assertEquals(adapter.toObject(), { MODE: "production" });
  });

  it("stores overrides without mutating the Worker environment", () => {
    const source = Object.freeze({ MODE: "production" });
    const adapter = new CloudflareEnvironmentAdapter(source);

    adapter.set("MODE", "test");
    adapter.set("ADDED", "value");

    assertEquals(source.MODE, "production");
    assertEquals(adapter.get("MODE"), "test");
    assertEquals(adapter.toObject(), { MODE: "test", ADDED: "value" });
  });

  it("accepts named environments and reads dynamically requested bindings", () => {
    const env: WranglerStyleEnv = {
      MODE: "production",
      VERSION: "1",
      SERVICE: { fetch: () => Promise.resolve(new Response("service")) },
    };
    const adapter = new CloudflareEnvironmentAdapter(env);

    assertEquals(adapter.get("VERSION"), "1");
    assertEquals(adapter.get("MISSING"), undefined);
    assertEquals(adapter.toObject(), { MODE: "production", VERSION: "1" });
  });
});
