import "#veryfront/schemas/_test-setup.ts";
import {
  assertEquals,
  assertExists,
  assertRejects,
  assertThrows,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { revokeModelRuntimeResolver } from "./model-transport.ts";
import {
  createProjectRunInferenceModelResolver,
  PROJECT_RUN_INFERENCE_TOKEN_HEADER,
  runWithProjectRunInferenceCredential,
} from "./project-run-inference-credential.ts";

// Hermetic: nothing here reaches the network. Calls that would send the
// credential are covered in tests/integration/agent/.
const TOKEN = "project-run-unit-token";
const MODEL = "veryfront-cloud/openai/gpt-test";
const REVOKED = "Project run inference credential is no longer active";

describe("agent/runtime/project-run-inference-credential", () => {
  it("names the execute request header", () => {
    assertEquals(PROJECT_RUN_INFERENCE_TOKEN_HEADER, "X-Veryfront-Inference-Token");
  });

  it("builds no resolver outside a scope", () => {
    assertEquals(createProjectRunInferenceModelResolver(), undefined);
  });

  it("resolves only managed models in scope", async () => {
    await runWithProjectRunInferenceCredential(TOKEN, () => {
      const resolver = createProjectRunInferenceModelResolver();
      assertExists(resolver);
      assertEquals(resolver("project-test/model"), undefined);
      assertExists(resolver(MODEL));
      return Promise.resolve();
    });
  });

  it("returns the execution's result", async () => {
    assertEquals(await runWithProjectRunInferenceCredential(TOKEN, () => Promise.resolve(42)), 42);
  });

  it("stops a revoked resolver's model and refuses new models once the scope settles", async () => {
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

    await assertRejects(() => revokedModel.doGenerate({ prompt: [] }), TypeError, REVOKED);
    await assertRejects(() => liveModel.doStream({ prompt: [] }), TypeError, REVOKED);
    assertThrows(() => resolver(MODEL), TypeError, REVOKED);
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
    assertThrows(() => retained!(MODEL), TypeError, REVOKED);
  });
});
