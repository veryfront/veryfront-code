import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { VeryfrontError } from "#veryfront/errors";
import { createLLMProviderRegistry } from "./llm-provider-registry.ts";
import type { LLMProvider } from "./llm-provider.ts";

function fakeProvider(id: string): LLMProvider {
  return {
    id,
    createModel: () => {
      throw new Error("not used");
    },
  };
}

describe("LLMProviderRegistry", () => {
  it("register + get returns the same instance", () => {
    const reg = createLLMProviderRegistry();
    const p = fakeProvider("openai");
    reg.register(p);
    assertEquals(reg.get("openai"), p);
    assert(reg.has("openai"));
  });

  it("get returns undefined for unknown id", () => {
    const reg = createLLMProviderRegistry();
    assertEquals(reg.get("nope"), undefined);
    assertEquals(reg.has("nope"), false);
  });

  it("require throws with a helpful message listing known providers", () => {
    const reg = createLLMProviderRegistry();
    reg.register(fakeProvider("openai"));
    reg.register(fakeProvider("anthropic"));
    assertThrows(
      () => reg.require("google"),
      Error,
      "google",
    );
    assertThrows(
      () => reg.require("google"),
      Error,
      "openai, anthropic",
    );
    let thrown: unknown;
    try {
      reg.require("google");
    } catch (error) {
      thrown = error;
    }
    assert(thrown instanceof VeryfrontError);
    assertEquals(thrown.slug, "resource-not-found");
  });

  it("keeps idempotent registration but rejects conflicting duplicate ids", () => {
    const reg = createLLMProviderRegistry();
    const p1 = fakeProvider("openai");
    const p2 = fakeProvider("openai");
    reg.register(p1);
    reg.register(p1);
    assertEquals(reg.get("openai"), p1);
    assertThrows(
      () => reg.register(p2),
      Error,
      "already registered",
    );
  });

  it("unregister allows re-registration", () => {
    const reg = createLLMProviderRegistry();
    const p1 = fakeProvider("openai");
    const p2 = fakeProvider("openai");
    reg.register(p1);
    reg.unregister("openai");
    reg.register(p2);
    assertEquals(reg.get("openai"), p2);
  });

  it("list returns providers in insertion order", () => {
    const reg = createLLMProviderRegistry();
    reg.register(fakeProvider("openai"));
    reg.register(fakeProvider("anthropic"));
    reg.register(fakeProvider("google"));
    assertEquals(reg.list().map((p) => p.id), ["openai", "anthropic", "google"]);
  });

  it("rejects invalid provider ids and implementations", () => {
    const reg = createLLMProviderRegistry();
    for (
      const id of [
        "",
        " openai",
        "openai\nlog",
        "open/ai",
        "open,ai",
        "open ai",
        "x".repeat(129),
      ]
    ) {
      assertThrows(
        () => reg.register(fakeProvider(id)),
        Error,
        "LLM provider id",
      );
    }
    assertThrows(
      () => reg.register({ id: "missing-method" } as unknown as LLMProvider),
      Error,
      "createModel must be a function",
    );
    assertThrows(
      () =>
        reg.register({
          ...fakeProvider("invalid-optional"),
          createEmbedding: "not-a-function",
        } as unknown as LLMProvider),
      Error,
      "createEmbedding must be a function",
    );

    const revoked = Proxy.revocable({}, {});
    revoked.revoke();
    let error: unknown;
    try {
      reg.register(revoked.proxy as LLMProvider);
    } catch (caught) {
      error = caught;
    }
    assertEquals(error instanceof VeryfrontError, true);
    assertEquals(String(error).includes("revoked"), false);
  });

  it("rejects invalid lookup ids without reflecting them in errors", () => {
    const reg = createLLMProviderRegistry();
    const invalidId = `sensitive-value\n${"x".repeat(200)}`;
    let message = "";
    try {
      reg.require(invalidId);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    assert(message.length > 0);
    assertEquals(message.includes(invalidId), false);
    assertEquals(message.includes("sensitive-value"), false);
  });

  it("bounds the number of registered providers", () => {
    const reg = createLLMProviderRegistry();
    for (let index = 0; index < 256; index += 1) {
      reg.register(fakeProvider(`provider-${index}`));
    }
    assertThrows(
      () => reg.register(fakeProvider("provider-overflow")),
      Error,
      "at most 256",
    );
  });

  it("rejects provider id mutation after registration", () => {
    const reg = createLLMProviderRegistry();
    const provider = fakeProvider("openai") as LLMProvider & { id: string };
    reg.register(provider);
    provider.id = "renamed";

    assertThrows(
      () => reg.list(),
      Error,
      "cannot change after registration",
    );
    assertThrows(
      () => reg.has("openai"),
      Error,
      "cannot change after registration",
    );
  });

  it("rejects stateful provider ids during registration", () => {
    const reg = createLLMProviderRegistry();
    let reads = 0;
    const provider: LLMProvider = {
      get id() {
        reads += 1;
        return reads === 1 ? "first" : "second";
      },
      createModel() {
        throw new Error("not used");
      },
    };

    assertThrows(
      () => reg.register(provider),
      Error,
      "must remain stable during registration",
    );
    assertEquals(reg.list(), []);
  });
});
