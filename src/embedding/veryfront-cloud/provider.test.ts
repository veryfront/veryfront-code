import { assertEquals } from "#veryfront/testing/assert.ts";
import { embedding } from "#veryfront/embedding/embedding.ts";
import { runWithVeryfrontCloudContextAsync } from "#veryfront/provider/veryfront-cloud/context.ts";

Deno.test("scoped managed embedding initializes the built-in Google transport without a registry", async () => {
  await runWithVeryfrontCloudContextAsync({
    apiToken: "synthetic-scoped-token",
    projectSlug: "synthetic-project",
    apiBaseUrl: "https://example.test",
    serviceLayer: "cloud",
  }, async () => {
    const model = embedding({});
    assertEquals(model.model, "veryfront-cloud/google/gemini-embedding-001");
    await Promise.resolve();
  });
});
