import "#veryfront/schemas/_test-setup.ts";
import {
  assertEquals,
  assertExists,
  assertRejects,
  assertThrows,
} from "#veryfront/testing/assert.ts";
import { it } from "#veryfront/testing/bdd.ts";
import { revokeModelRuntimeResolver } from "../runtime/model-transport.ts";
import type { ParsedHostedChatRequest } from "./chat-request-parser.ts";
import {
  bindHostedChildInferenceAuthority,
  createHostedChildInferenceModelResolver,
  createHostedRuntimeWithChildInferenceAuthority,
  inheritHostedChildInferenceAuthority,
  registerHostedInferenceCredential,
  scopeHostedChildInferenceAuthority,
} from "./inference-credential.ts";

const API_URL = "https://api.veryfront.com";
const MODEL = "veryfront-cloud/mistral/mistral-small-2503";
const PARENT_RETIRED = "Hosted parent inference authority is no longer active";
const CHILD_RETIRED = "Hosted child inference authority is no longer active";

function verifiedRequest(): ParsedHostedChatRequest {
  const request = { authToken: "test-execution-authority" } as ParsedHostedChatRequest;
  registerHostedInferenceCredential(request, "test-inference-authority");
  return request;
}

// These cases exercise private lifetime decisions only. Retained-model calls
// occur after revocation and must fail before catalog or provider transport.
it("does not manufacture child authority without a verified inference credential", async () => {
  const owner = {};
  const child = {};
  const request = { authToken: "test-execution-authority" } as ParsedHostedChatRequest;
  bindHostedChildInferenceAuthority(owner, request, { apiBaseUrl: API_URL })();
  inheritHostedChildInferenceAuthority(child, owner);
  scopeHostedChildInferenceAuthority(child, owner)();
  assertEquals(createHostedChildInferenceModelResolver(owner), undefined);
  assertEquals(createHostedChildInferenceModelResolver(child), undefined);
  let cleanups = 0;
  const runtime = await createHostedRuntimeWithChildInferenceAuthority(owner, undefined, {
    apiBaseUrl: API_URL,
  }, () =>
    Promise.resolve({
      cleanup: () => {
        cleanups++;
        return Promise.resolve();
      },
    }));
  await runtime.cleanup();
  await runtime.cleanup();
  assertEquals(cleanups, 1);
});

it("root retirement denies existing and inherited child models", async () => {
  const owner = {};
  const child = {};
  const retire = bindHostedChildInferenceAuthority(owner, verifiedRequest(), {
    apiBaseUrl: API_URL,
  });
  inheritHostedChildInferenceAuthority(child, owner);
  const resolver = createHostedChildInferenceModelResolver(child);
  assertExists(resolver);
  assertEquals(resolver("local/test-model"), undefined);
  const model = resolver(MODEL);
  assertExists(model);
  retire();
  assertThrows(() => createHostedChildInferenceModelResolver(child), TypeError, PARENT_RETIRED);
  await assertRejects(async () => await model.doStream({ prompt: [] }), TypeError, PARENT_RETIRED);
  assertEquals(Object.keys(owner), []);
  assertEquals(Object.keys(child), []);
});

it("one child resolver retirement preserves independently issued sibling resolvers", async () => {
  const owner = {};
  const retire = bindHostedChildInferenceAuthority(owner, verifiedRequest(), {
    apiBaseUrl: API_URL,
  });
  const first = createHostedChildInferenceModelResolver(owner);
  const sibling = createHostedChildInferenceModelResolver(owner);
  assertExists(first);
  assertExists(sibling);
  const model = first(MODEL);
  assertExists(model);
  revokeModelRuntimeResolver(first);
  await assertRejects(
    async () => await model.doStream({ prompt: [] }),
    TypeError,
    "Run-scoped inference credential is no longer active",
  );
  assertExists(sibling(MODEL));
  retire();
});

it("parent cancellation denies new child authority even when the signal was already aborted", () => {
  for (const alreadyAborted of [false, true]) {
    const owner = {};
    const controller = new AbortController();
    if (alreadyAborted) controller.abort();
    const retire = bindHostedChildInferenceAuthority(owner, verifiedRequest(), {
      apiBaseUrl: API_URL,
      signal: controller.signal,
    });
    if (!alreadyAborted) assertExists(createHostedChildInferenceModelResolver(owner));
    controller.abort();
    assertThrows(() => createHostedChildInferenceModelResolver(owner), TypeError, PARENT_RETIRED);
    retire();
  }
});

it("immediate child settlement denies descendants while its root remains active", async () => {
  const root = {};
  const child = {};
  const descendant = {};
  const retireRoot = bindHostedChildInferenceAuthority(root, verifiedRequest(), {
    apiBaseUrl: API_URL,
  });
  const retireChild = scopeHostedChildInferenceAuthority(child, root);
  const retireDescendant = scopeHostedChildInferenceAuthority(descendant, child);
  const resolver = createHostedChildInferenceModelResolver(descendant);
  assertExists(resolver);
  const model = resolver(MODEL);
  assertExists(model);
  retireChild();
  assertThrows(() => createHostedChildInferenceModelResolver(descendant), TypeError, CHILD_RETIRED);
  await assertRejects(async () => await model.doStream({ prompt: [] }), TypeError, CHILD_RETIRED);
  assertExists(createHostedChildInferenceModelResolver(root));
  retireDescendant();
  retireRoot();
});

it("actual child cancellation denies retained descendants", () => {
  for (const alreadyAborted of [false, true]) {
    const root = {};
    const child = {};
    const retireRoot = bindHostedChildInferenceAuthority(root, verifiedRequest(), {
      apiBaseUrl: API_URL,
    });
    const controller = new AbortController();
    if (alreadyAborted) controller.abort();
    const retireChild = scopeHostedChildInferenceAuthority(child, root, controller.signal);
    if (!alreadyAborted) assertExists(createHostedChildInferenceModelResolver(child));
    controller.abort();
    assertThrows(() => createHostedChildInferenceModelResolver(child), TypeError, CHILD_RETIRED);
    retireChild();
    retireRoot();
  }
});

it("runtime cleanup retires child authority before its own cleanup and executes once", async () => {
  const owner = {};
  let cleanups = 0;
  const runtime = await createHostedRuntimeWithChildInferenceAuthority(owner, verifiedRequest(), {
    apiBaseUrl: API_URL,
  }, () =>
    Promise.resolve({
      value: 42,
      cleanup: () => {
        assertThrows(
          () => createHostedChildInferenceModelResolver(owner),
          TypeError,
          PARENT_RETIRED,
        );
        cleanups++;
        return Promise.resolve();
      },
    }));
  assertExists(createHostedChildInferenceModelResolver(owner));
  assertEquals(runtime.value, 42);
  await runtime.cleanup();
  await runtime.cleanup();
  assertEquals(cleanups, 1);
});

it("failed runtime construction retires child authority and preserves the original error", async () => {
  const owner = {};
  const failure = new Error("Runtime preparation failed");
  let caught: unknown;
  try {
    await createHostedRuntimeWithChildInferenceAuthority(owner, verifiedRequest(), {
      apiBaseUrl: API_URL,
    }, () => {
      assertExists(createHostedChildInferenceModelResolver(owner));
      throw failure;
    });
  } catch (error) {
    caught = error;
  }
  assertEquals(caught, failure);
  assertThrows(() => createHostedChildInferenceModelResolver(owner), TypeError, PARENT_RETIRED);
});
