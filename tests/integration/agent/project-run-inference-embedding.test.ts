import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists, assertRejects } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { installMockFetch, restoreMockFetch } from "#veryfront/testing/mock-fetch.ts";
import { deleteEnv, setEnv } from "#veryfront/compat/process.ts";
import { ensureBuiltinLLMProviders } from "#veryfront/extensions/builtin-extensions.ts";
import { runWithVeryfrontCloudContextAsync } from "#veryfront/provider/veryfront-cloud/context.ts";
import {
  createProjectRunInferenceEmbeddingModel,
  runWithProjectRunInferenceCredential,
} from "#veryfront/agent/runtime/project-run-inference-credential.ts";

const TOKEN = "x".repeat(16 * 1024);

describe("project run signed embedding authority", () => {
  afterEach(() => {
    restoreMockFetch();
    deleteEnv("VERYFRONT_API_TOKEN");
  });

  for (const provider of ["openai", "google"]) {
    it(`sends ${provider} embeddings with private authority to the trusted origin`, async () => {
      setEnv("VERYFRONT_API_TOKEN", "broader-runtime-token");
      const requests: Request[] = [];
      installMockFetch(async (input, init) => {
        requests.push(new Request(input, init));
        return Response.json(
          provider === "openai"
            ? {
              data: [{ embedding: [1, 2], index: 0 }],
              usage: { prompt_tokens: 2, total_tokens: 2 },
            }
            : { embeddings: [{ values: [1, 2] }] },
        );
      });
      const registry = ensureBuiltinLLMProviders();
      const builtinGoogle = registry.require("google");
      let extensionCalled = false;
      registry.unregister("google");
      registry.register({
        id: "google",
        createModel() {
          throw new Error("unexpected language model");
        },
        createEmbedding() {
          extensionCalled = true;
          throw new Error("extension must not receive signed authority");
        },
      });
      const originalSet = Object.getOwnPropertyDescriptor(Headers.prototype, "set");
      assertExists(originalSet);
      const nativeCredentials: string[] = [];
      Object.defineProperty(Headers.prototype, "set", {
        ...originalSet,
        value(this: Headers, name: string, value: string) {
          if (name.toLowerCase() === "authorization" || name.toLowerCase() === "x-goog-api-key") {
            nativeCredentials.push(value);
          }
          return Reflect.apply(originalSet.value, this, [name, value]);
        },
      });
      try {
        await runWithProjectRunInferenceCredential(TOKEN, () =>
          runWithVeryfrontCloudContextAsync({
            apiBaseUrl: "https://attacker.example/api/v1",
            apiToken: "project-controlled-token",
          }, async () => {
            const model = createProjectRunInferenceEmbeddingModel(
              `veryfront-cloud/${provider}/${
                provider === "openai" ? "text-embedding-3-small" : "text-embedding-004"
              }`,
            );
            assertExists(model);
            assertEquals(JSON.stringify(model).includes(TOKEN), false);
            assertEquals((await model.doEmbed({ values: ["document"] })).embeddings, [[1, 2]]);
          }));
      } finally {
        Object.defineProperty(Headers.prototype, "set", originalSet);
        registry.unregister("google");
        registry.register(builtinGoogle);
      }
      assertEquals(extensionCalled, false);
      assertEquals(requests.length, 1);
      const request = requests[0];
      assertExists(request);
      assertEquals(request.headers.get("Authorization") === `Bearer ${TOKEN}`, true);
      assertEquals(new URL(request.url).host === "attacker.example", false);
      assertEquals(nativeCredentials.some((value) => value.includes(TOKEN)), false);
    });
  }

  it("sends no request after authority expires", async () => {
    setEnv("VERYFRONT_API_TOKEN", "broader-runtime-token");
    let requests = 0;
    installMockFetch(() => {
      requests++;
      return Promise.resolve(Response.json({ data: [{ embedding: [1], index: 0 }] }));
    });
    const retained = await runWithProjectRunInferenceCredential(TOKEN, () =>
      Promise.resolve(
        createProjectRunInferenceEmbeddingModel("veryfront-cloud/openai/text-embedding-3-small"),
      ));
    assertExists(retained);
    await assertRejects(
      async () => await retained.doEmbed({ values: ["document"] }),
      TypeError,
      "no longer active",
    );
    assertEquals(requests, 0);
  });
});
