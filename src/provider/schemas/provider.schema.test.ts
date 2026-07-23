import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { CompletionRequestSchema, ProviderConfigSchema } from "./provider.schema.ts";

describe("provider/schemas", () => {
  it("rejects credential-bearing provider URLs", () => {
    assertEquals(
      ProviderConfigSchema.safeParse({ baseURL: "https://user:password@provider.example/v1" })
        .success,
      false,
    );
  });

  it("bounds provider credentials", () => {
    assertEquals(ProviderConfigSchema.safeParse({ apiKey: "" }).success, false);
    assertEquals(
      ProviderConfigSchema.safeParse({ apiKey: "x".repeat(16_385) }).success,
      false,
    );
    assertEquals(
      ProviderConfigSchema.safeParse({ apiKey: "secret\nvalue" }).success,
      false,
    );
    assertEquals(ProviderConfigSchema.safeParse({ apiKey: "   " }).success, false);
  });

  it("bounds completion messages and rejects unknown request fields", () => {
    const baseRequest = {
      model: "openai/model",
      messages: [{ role: "user", content: "hello" }],
    };
    assertEquals(CompletionRequestSchema.safeParse(baseRequest).success, true);
    assertEquals(
      CompletionRequestSchema.safeParse({ ...baseRequest, messages: [] }).success,
      false,
    );
    assertEquals(
      CompletionRequestSchema.safeParse({ ...baseRequest, unexpected: true }).success,
      false,
    );
    assertEquals(
      CompletionRequestSchema.safeParse({ ...baseRequest, model: "model\nprivate" }).success,
      false,
    );
  });
});
