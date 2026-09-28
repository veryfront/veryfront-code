import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { revokeModelRuntimeResolver } from "../runtime/model-transport.ts";
import { createHostedApplicationModelResolver } from "./application-model-resolver.ts";
import {
  __resetVeryfrontCloudCatalogForTests,
  __setVeryfrontCloudCatalogForScopeForTests,
} from "#veryfront/provider/veryfront-cloud/catalog-client.ts";

const modelId = "veryfront-cloud/openai/gpt-4o";

function resolverOptions() {
  const owner = new AbortController();
  return {
    authToken: "synthetic-application-token",
    apiBaseUrl: "https://example.com",
    allowedModelIds: new Set([modelId]),
    scope: {
      binding: { allocationId: "allocation-test", generation: 1, invocationId: "invocation-test" },
      signal: owner.signal,
      assertActive() {
        owner.signal.throwIfAborted();
      },
    },
  };
}

describe("hosted application model authority", () => {
  it("requires an explicit HTTP gateway without credentials, query, or fragment", () => {
    for (const apiBaseUrl of ["", " https://example.com", "example.com"]) {
      assertThrows(
        () => createHostedApplicationModelResolver({ ...resolverOptions(), apiBaseUrl }),
        TypeError,
        "gateway URL",
      );
    }
    for (
      const apiBaseUrl of [
        "file:///synthetic-gateway",
        "https://synthetic-user@example.com",
        "https://example.com?project=synthetic",
        "https://example.com#synthetic",
      ]
    ) {
      assertThrows(
        () => createHostedApplicationModelResolver({ ...resolverOptions(), apiBaseUrl }),
        TypeError,
        "valid gateway URL",
      );
    }
  });

  it("accepts absent context labels and rejects labels that cannot be sent as bounded headers", () => {
    for (const label of [undefined, null, "", "synthetic-project"]) {
      const resolver = createHostedApplicationModelResolver({
        ...resolverOptions(),
        projectSlug: label,
        billingGroupId: label,
      });
      assert(resolver(modelId));
      revokeModelRuntimeResolver(resolver);
    }
    for (const label of ["synthetic project", "synthetic\nproject", "x".repeat(257)]) {
      for (const field of ["projectSlug", "billingGroupId"]) {
        assertThrows(
          () => createHostedApplicationModelResolver({ ...resolverOptions(), [field]: label }),
          TypeError,
          "context is invalid",
        );
      }
    }
  });

  it("caches allowed models while keeping the original allowlist independent of later edits", () => {
    const options = resolverOptions();
    const resolver = createHostedApplicationModelResolver(options);
    const model = resolver(modelId);
    assert(model);
    options.allowedModelIds.clear();
    options.allowedModelIds.add("veryfront-cloud/openai/other");
    assertEquals(resolver(modelId), model);
    assertEquals(resolver("project/custom"), undefined);
    assertThrows(() => resolver("veryfront-cloud/openai/other"), TypeError, "not allowed");
    assertEquals(model.modelId, "gpt-4o");
    assertEquals(model.modelProvider, "openai");
    revokeModelRuntimeResolver(resolver);
  });

  it("rejects an already cancelled call without revoking other calls", async () => {
    const resolver = createHostedApplicationModelResolver(resolverOptions());
    const model = resolver(modelId)!;
    assert(model.prepare);
    const signal = AbortSignal.abort(new Error("Synthetic caller cancellation"));
    await assertRejects(async () => await model.prepare!(signal), Error, "inference cancelled");
    await assertRejects(
      async () => await model.doGenerate({ prompt: [], abortSignal: signal }),
      Error,
      "inference cancelled",
    );
    await assertRejects(
      async () => await model.doStream({ prompt: [], abortSignal: signal }),
      Error,
      "inference cancelled",
    );
    await model.prepare();
    assertEquals(resolver(modelId), model);
    revokeModelRuntimeResolver(resolver);
  });

  it("checks owner authority again after preparation yields", async () => {
    const options = resolverOptions();
    const owner = new AbortController();
    const resolver = createHostedApplicationModelResolver({
      ...options,
      scope: { ...options.scope, signal: owner.signal },
    });
    const model = resolver(modelId)!;
    assert(model.prepare);
    const preparation = model.prepare();
    owner.abort(new Error("Synthetic invocation ended"));
    await assertRejects(async () => await preparation, Error, "Synthetic invocation ended");
    assertThrows(() => resolver(modelId), Error, "Synthetic invocation ended");
    await assertRejects(async () => await model.prepare!(), Error, "Synthetic invocation ended");
    revokeModelRuntimeResolver(resolver);
  });

  it("revokes every cached model entrypoint, including provider metadata reconciliation", async () => {
    const googleId = "veryfront-cloud/google/gemini-synthetic";
    const resolver = createHostedApplicationModelResolver({
      ...resolverOptions(),
      allowedModelIds: new Set([modelId, googleId]),
    });
    const model = resolver(modelId)!;
    const reconcile = resolver(googleId)!._reconcileProviderMetadata;
    assert(typeof reconcile === "function");
    assertEquals(await reconcile({ providerMetadata: {}, suppressedToolCalls: [] }), {});
    revokeModelRuntimeResolver(resolver);
    assertThrows(() => resolver(modelId), TypeError, "authority is revoked");
    await assertRejects(async () => await model.prepare!(), TypeError, "authority is revoked");
    await assertRejects(
      async () => await model.doGenerate({ prompt: [] }),
      TypeError,
      "authority is revoked",
    );
    await assertRejects(
      async () => await model.doStream({ prompt: [] }),
      TypeError,
      "authority is revoked",
    );
    await assertRejects(
      async () => await reconcile({ providerMetadata: {}, suppressedToolCalls: [] }),
      TypeError,
      "authority is revoked",
    );
  });
  it("exposes the reconciliation hook of the protocol a model settles on", async () => {
    const servedId = "veryfront-cloud/acme/acme-gemini";
    const options = { ...resolverOptions(), allowedModelIds: new Set([servedId]) };
    try {
      const model = createHostedApplicationModelResolver(options)(servedId)!;
      // Cold, an unlisted provider is built as an OpenAI-protocol model. The
      // served catalog then names it as a spelling of Google, the one provider
      // the Google-protocol route serves.
      assertEquals(model._reconcileProviderMetadata, undefined);

      __setVeryfrontCloudCatalogForScopeForTests(
        { apiBaseUrl: options.apiBaseUrl, apiToken: options.authToken },
        {
          models: [{
            id: "acme-gemini",
            modelId: "acme/acme-gemini",
            provider: "google",
            surface: "google",
            operations: ["chat-completions"],
            aliases: [],
            capabilities: {},
          }],
        },
      );
      await model.prepare!();

      assert(typeof model._reconcileProviderMetadata === "function");
    } finally {
      __resetVeryfrontCloudCatalogForTests();
    }
  });
});
