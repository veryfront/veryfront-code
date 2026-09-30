import "#veryfront/schemas/_test-setup.ts";
import { agent as createAgent } from "#veryfront/agent";
import { deleteEnv, setEnv } from "#veryfront/compat/process.ts";
import { clearModelProviders } from "#veryfront/provider";
import {
  assertEquals,
  assertExists,
  assertRejects,
  assertThrows,
} from "#veryfront/testing/assert.ts";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import { installMockFetch, restoreMockFetch } from "#veryfront/testing/mock-fetch.ts";
import { seedServedCatalogForTests } from "#veryfront/provider/veryfront-cloud/catalog-client.test-helpers.ts";
import { __resetVeryfrontCloudCatalogForTests } from "#veryfront/provider/veryfront-cloud/catalog-client.ts";
import { revokeModelRuntimeResolver } from "./model-transport.ts";
import {
  createProjectRunInferenceModelResolver,
  PROJECT_RUN_INFERENCE_TOKEN_HEADER,
  runWithProjectRunInferenceCredential,
} from "./project-run-inference-credential.ts";

const TOKEN = "project-run-unit-token";
const MODEL = "veryfront-cloud/openai/gpt-test";
const encoder = new TextEncoder();

function captureBearers(): Array<string | null> {
  const bearers: Array<string | null> = [];
  installMockFetch(
    (async (input: URL | Request | string, init?: RequestInit) => {
      bearers.push(new Request(input, init).headers.get("Authorization"));
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(
              encoder.encode('data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n'),
            );
            controller.enqueue(encoder.encode('data: {"choices":[{"finish_reason":"stop"}]}\n\n'));
            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
            controller.close();
          },
        }),
        { status: 200, headers: { "content-type": "text/event-stream" } },
      );
    }) as typeof fetch,
  );
  return bearers;
}

describe("agent/runtime/project-run-inference-credential", () => {
  beforeEach(() => {
    seedServedCatalogForTests();
    setEnv("VERYFRONT_API_TOKEN", "broader-token");
    setEnv("VERYFRONT_PROJECT_SLUG", "provider-test-project");
  });
  afterEach(() => {
    __resetVeryfrontCloudCatalogForTests();
    restoreMockFetch();
    clearModelProviders();
    deleteEnv("VERYFRONT_API_TOKEN");
    deleteEnv("VERYFRONT_PROJECT_SLUG");
  });

  it("names the execute request header", () => {
    assertEquals(PROJECT_RUN_INFERENCE_TOKEN_HEADER, "X-Veryfront-Inference-Token");
  });

  it("builds no resolver outside a scope", () => {
    assertEquals(createProjectRunInferenceModelResolver(), undefined);
  });

  it("resolves managed models in scope and sends the credential", async () => {
    const bearers = captureBearers();
    await runWithProjectRunInferenceCredential(TOKEN, async () => {
      const resolver = createProjectRunInferenceModelResolver();
      assertExists(resolver);
      assertEquals(resolver("project-test/model"), undefined);
      const model = resolver(MODEL);
      assertExists(model);
      const result = await model.doStream({ prompt: [] });
      const reader = (result as { stream: ReadableStream<unknown> }).stream.getReader();
      while (!(await reader.read()).done) {
        // drain
      }
    });
    assertEquals(bearers, [`Bearer ${TOKEN}`]);
  });

  it("routes an agent's call through the scope", async () => {
    const bearers = captureBearers();
    const managed = createAgent({
      id: "unit-scoped-agent",
      model: MODEL,
      system: "Hi.",
      skills: false,
    });
    const response = await runWithProjectRunInferenceCredential(
      TOKEN,
      () => managed.generate({ input: "Hello" }),
    );
    assertEquals(response.text, "Hello");
    assertEquals(bearers, [`Bearer ${TOKEN}`]);
  });

  it("stops a revoked resolver's model and refuses new models once the scope settles", async () => {
    const bearers = captureBearers();
    const { resolver, revokedModel, liveModel } = await runWithProjectRunInferenceCredential(
      TOKEN,
      () => {
        const inScope = createProjectRunInferenceModelResolver();
        assertExists(inScope);
        const revokedResolver = createProjectRunInferenceModelResolver();
        assertExists(revokedResolver);
        const revoked = revokedResolver(MODEL);
        assertExists(revoked);
        revokeModelRuntimeResolver(revokedResolver);
        return Promise.resolve({
          resolver: inScope,
          revokedModel: revoked,
          liveModel: inScope(MODEL),
        });
      },
    );
    assertExists(liveModel);

    await assertRejects(
      () => revokedModel.doGenerate({ prompt: [] }),
      TypeError,
      "Project run inference credential is no longer active",
    );
    await assertRejects(
      () => liveModel.doStream({ prompt: [] }),
      TypeError,
      "Project run inference credential is no longer active",
    );
    assertThrows(
      () => resolver(MODEL),
      TypeError,
      "Project run inference credential is no longer active",
    );
    assertEquals(bearers, []);
  });

  it("deactivates the scope when the execution throws", async () => {
    let retained: ReturnType<typeof createProjectRunInferenceModelResolver>;
    await assertRejects(() =>
      runWithProjectRunInferenceCredential(TOKEN, () => {
        retained = createProjectRunInferenceModelResolver();
        return Promise.reject(new Error("execution failed"));
      })
    );
    assertExists(retained!);
    assertThrows(() => retained!(MODEL), TypeError);
  });
});
