import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { CloudflareEnvironmentAdapter } from "./environment.ts";
import type { CloudflareEnv, KVNamespace } from "./types.ts";

const kv = {
  delete: () => Promise.resolve(),
  get: () => Promise.resolve(null),
  getWithMetadata: () => Promise.resolve({ metadata: null, value: null }),
  list: () => Promise.resolve({ keys: [], list_complete: true, cursor: "" }),
  put: () => Promise.resolve(),
} satisfies KVNamespace;

describe("CloudflareEnvironmentAdapter", () => {
  it("overlays string values without mutating deployment bindings", () => {
    const bindings: CloudflareEnv = {
      API_URL: "https://api.example.com",
      FILES: kv,
    };
    const environment = new CloudflareEnvironmentAdapter(bindings);

    environment.set("API_URL", "https://override.example.com");
    environment.set("FILES", "request-local-shadow");

    assertEquals(bindings.API_URL, "https://api.example.com");
    assertEquals(bindings.FILES, kv);
    assertEquals(environment.get("API_URL"), "https://override.example.com");
    assertEquals(environment.get("FILES"), "request-local-shadow");
    assertEquals(environment.toObject(), {
      API_URL: "https://override.example.com",
      FILES: "request-local-shadow",
    });
  });

  it("snapshots own string bindings and preserves special keys as data", () => {
    const inherited = { INHERITED: "not-a-binding" };
    const bindings = Object.create(inherited) as CloudflareEnv;
    bindings.API_URL = "https://initial.example.com";
    Object.defineProperty(bindings, "__proto__", {
      value: "literal",
      enumerable: true,
      configurable: true,
    });

    const environment = new CloudflareEnvironmentAdapter(bindings);
    bindings.API_URL = "https://mutated.example.com";

    assertEquals(environment.get("API_URL"), "https://initial.example.com");
    assertEquals(environment.get("INHERITED"), undefined);
    assertEquals(environment.get("__proto__"), "literal");
    assertEquals(Object.hasOwn(environment.toObject(), "__proto__"), true);
  });
});
