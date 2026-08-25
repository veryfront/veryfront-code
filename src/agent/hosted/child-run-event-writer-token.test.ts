import { assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { AsyncLocalStorage } from "node:async_hooks";
import {
  createHostedConversationRunChunkMirrorFromCapability,
  createHostedRunEventWriterCapability,
  createHostedRunEventWriterCapabilityForRequest,
  getActiveHostedRunEventWriterCapability,
  HostedChildRunEventWriterTokenExchangeError,
  registerHostedRunEventWriterToken,
  runWithHostedRunEventWriterCapability,
  runWithVerifiedHostedRunEventWriterRequest,
} from "./child-run-event-writer-token.ts";

Deno.test("explicit authority-less scopes clear and restore ambient writer authority", async () => {
  const capability = createHostedRunEventWriterCapability({
    apiUrl: "https://api.example.com/",
    runId: "run_parent",
    runEventAppendToken: "parent-writer-token",
  });

  await runWithHostedRunEventWriterCapability(capability, async () => {
    assertEquals(getActiveHostedRunEventWriterCapability(), capability);

    await runWithHostedRunEventWriterCapability(undefined, async () => {
      const detachedCapability = getActiveHostedRunEventWriterCapability();
      assertEquals(detachedCapability, undefined);
      assertEquals(detachedCapability?.mintChildRunEventWriterCapability, undefined);
    });

    assertEquals(getActiveHostedRunEventWriterCapability(), capability);
    await Promise.resolve();
    assertEquals(getActiveHostedRunEventWriterCapability(), capability);
  });

  assertEquals(getActiveHostedRunEventWriterCapability(), undefined);
});

Deno.test("writer authority is revoked from detached async work after its scope settles", async () => {
  const capability = createHostedRunEventWriterCapability({
    apiUrl: "https://api.example.com/",
    runId: "run_parent",
    runEventAppendToken: "parent-writer-token",
  });
  const releaseDetached = Promise.withResolvers<void>();
  const detachedFinished = Promise.withResolvers<void>();
  let detachedCapability: unknown = "not-observed";

  await runWithHostedRunEventWriterCapability(capability, () => {
    queueMicrotask(async () => {
      await releaseDetached.promise;
      detachedCapability = getActiveHostedRunEventWriterCapability();
      detachedFinished.resolve();
    });
    return Promise.resolve();
  });

  releaseDetached.resolve();
  await detachedFinished.promise;
  assertEquals(detachedCapability, undefined);
});

Deno.test("run event writer capability delegates parent to child to grandchild exactly once without exposing credentials", async () => {
  const requests: Request[] = [];
  const responses = ["child-writer-token", "grandchild-writer-token"];
  const capability = createHostedRunEventWriterCapability({
    apiUrl: "https://api.example.com/",
    runId: "run_parent",
    runEventAppendToken: "parent-writer-token",
    fetch: (input, init) => {
      requests.push(new Request(input, init));
      return Promise.resolve(
        Response.json(
          { run_event_token: responses[requests.length - 1] },
          { headers: { "Cache-Control": "no-store" } },
        ),
      );
    },
  });
  const childCapability = await capability.mintChildRunEventWriterCapability("run_child");
  const grandchildCapability = await childCapability.mintChildRunEventWriterCapability(
    "run_grandchild",
  );

  assertEquals(
    requests.map((request) => request.url),
    [
      "https://api.example.com/runs/run_parent/children/run_child/event-writer-token",
      "https://api.example.com/runs/run_child/children/run_grandchild/event-writer-token",
    ],
  );
  assertEquals(
    requests.map((request) => request.headers.get("Authorization")),
    ["Bearer parent-writer-token", "Bearer child-writer-token"],
  );
  assertEquals(requests.every((request) => request.method === "POST"), true);
  assertEquals(
    requests.every((request) => request.headers.get("Cache-Control") === "no-store"),
    true,
  );
  assertEquals(await Promise.all(requests.map((request) => request.text())), ["", ""]);
  assertEquals(Object.keys(capability), []);
  assertEquals(
    JSON.stringify({ capability, childCapability, grandchildCapability }),
    '{"capability":{},"childCapability":{},"grandchildCapability":{}}',
  );
});

Deno.test("capability-backed mirrors ignore caller-supplied API and run identities", async () => {
  const originalFetch = globalThis.fetch;
  const requests: Request[] = [];
  const conversationId = "11111111-1111-4111-8111-111111111111";
  try {
    globalThis.fetch = ((input, init) => {
      const request = new Request(input, init);
      requests.push(request);
      return Promise.resolve(
        Response.json({
          latestEventId: 1,
          latestExternalEventSequence: 1,
          appendedCount: 1,
          run: {
            runId: "run_trusted",
            conversationId,
            latestEventId: 1,
            latestExternalEventSequence: 1,
          },
        }),
      );
    }) as typeof fetch;
    const capability = createHostedRunEventWriterCapability({
      apiUrl: "https://trusted.example.test",
      runId: "run_trusted",
      runEventAppendToken: "trusted-writer-token",
      fetch: globalThis.fetch,
    });
    const mirror = createHostedConversationRunChunkMirrorFromCapability(
      capability,
      {
        expectedRunId: "run_trusted",
        apiUrl: "https://attacker.example.test",
        conversationId,
        runId: "run_attacker",
        latestEventId: 0,
        latestExternalEventSequence: 0,
      } as never,
    );
    if (!mirror) {
      throw new Error("Expected a mirror for a valid writer capability");
    }

    await mirror.appendEvents([{ type: "TEXT_MESSAGE_CONTENT", delta: "persisted" }]);
    await mirror.flush();
    mirror.dispose();

    assertEquals(requests.length, 1);
    const request = requests[0];
    if (!request) {
      throw new Error("Expected one mirror append request");
    }
    assertEquals(
      request.url,
      `${"https://trusted.example.test"}/conversations/${conversationId}/runs/run_trusted/events`,
    );
    assertEquals(request.headers.get("Authorization"), "Bearer trusted-writer-token");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

for (const capabilityRunId of ["run_parent", "run_sibling"]) {
  Deno.test(`capability-backed mirrors reject ${capabilityRunId} authority for another child`, () => {
    const capability = createHostedRunEventWriterCapability({
      apiUrl: "https://api.example.test",
      runId: capabilityRunId,
      runEventAppendToken: "scoped-writer-token",
    });

    const mirror = createHostedConversationRunChunkMirrorFromCapability(capability, {
      expectedRunId: "run_child",
      conversationId: "11111111-1111-4111-a111-111111111111",
      latestEventId: 0,
      latestExternalEventSequence: 0,
    });

    assertEquals(mirror, undefined);
  });
}

Deno.test("run event writer capability preserves the configured API base path", async () => {
  let requestUrl: string | undefined;
  const capability = createHostedRunEventWriterCapability({
    apiUrl: "https://api.example.test/v1",
    runId: "run_parent",
    runEventAppendToken: "parent-writer-token",
    fetch: (input, init) => {
      requestUrl = new Request(input, init).url;
      return Promise.resolve(
        Response.json(
          { run_event_token: "child-writer-token" },
          { headers: { "Cache-Control": "no-store" } },
        ),
      );
    },
  });

  await capability.mintChildRunEventWriterCapability("run_child");

  assertEquals(
    requestUrl,
    "https://api.example.test/v1/runs/run_parent/children/run_child/event-writer-token",
  );
});

Deno.test("mintChildRunEventWriterCapability rejects responses without no-store", async () => {
  await assertRejects(
    () =>
      createHostedRunEventWriterCapability({
        apiUrl: "https://api.example.com",
        runId: "run_parent",
        runEventAppendToken: "parent-writer-token",
        fetch: () => Promise.resolve(Response.json({ run_event_token: "child-writer-token" })),
      }).mintChildRunEventWriterCapability("run_child"),
    HostedChildRunEventWriterTokenExchangeError,
    "Unable to initialize durable child event persistence",
  );
});

Deno.test("mintChildRunEventWriterCapability rejects an oversized response body", async () => {
  await assertRejects(
    () =>
      createHostedRunEventWriterCapability({
        apiUrl: "https://api.example.com",
        runId: "run_parent",
        runEventAppendToken: "parent-writer-token",
        fetch: () =>
          Promise.resolve(
            new Response(
              `${" ".repeat(20_000)}{"run_event_token":"child-writer-token"}`,
              { headers: { "Cache-Control": "no-store" } },
            ),
          ),
      }).mintChildRunEventWriterCapability("run_child"),
    HostedChildRunEventWriterTokenExchangeError,
    "Unable to initialize durable child event persistence",
  );
});

Deno.test("mintChildRunEventWriterCapability rejects an oversized token", async () => {
  await assertRejects(
    () =>
      createHostedRunEventWriterCapability({
        apiUrl: "https://api.example.com",
        runId: "run_parent",
        runEventAppendToken: "parent-writer-token",
        fetch: () =>
          Promise.resolve(
            Response.json(
              { run_event_token: "x".repeat(5_000) },
              { headers: { "Cache-Control": "no-store" } },
            ),
          ),
      }).mintChildRunEventWriterCapability("run_child"),
    HostedChildRunEventWriterTokenExchangeError,
    "Unable to initialize durable child event persistence",
  );
});

Deno.test("run event writer capabilities reject oversized root tokens", () => {
  assertThrows(
    () =>
      createHostedRunEventWriterCapability({
        apiUrl: "https://api.example.com",
        runId: "run_parent",
        runEventAppendToken: "x".repeat(5_000),
      }),
    HostedChildRunEventWriterTokenExchangeError,
    "Unable to initialize durable child event persistence",
  );
});

Deno.test("mintChildRunEventWriterCapability rejects control-plane errors without reading their body", async () => {
  let bodyRead = false;
  const response = new Response("parent-writer-token-must-not-leak", { status: 503 });
  const originalJson = response.json.bind(response);
  response.json = () => {
    bodyRead = true;
    return originalJson();
  };

  const error = await assertRejects(
    () =>
      createHostedRunEventWriterCapability({
        apiUrl: "https://api.example.com",
        runId: "run_parent",
        runEventAppendToken: "parent-writer-token",
        fetch: () => Promise.resolve(response),
      }).mintChildRunEventWriterCapability("run_child"),
    HostedChildRunEventWriterTokenExchangeError,
    "Unable to initialize durable child event persistence",
  );
  assertEquals(bodyRead, false);
  assertEquals(
    error instanceof HostedChildRunEventWriterTokenExchangeError && error.classification,
    "failed",
  );
});

for (
  const body of [
    {},
    { run_event_token: "" },
    { run_event_token: 1 },
    { run_event_token: "child-writer-token", extra: true },
  ]
) {
  Deno.test(`mintChildRunEventWriterCapability rejects invalid response ${JSON.stringify(body)}`, async () => {
    await assertRejects(
      () =>
        createHostedRunEventWriterCapability({
          apiUrl: "https://api.example.com",
          runId: "run_parent",
          runEventAppendToken: "parent-writer-token",
          fetch: () =>
            Promise.resolve(
              Response.json(body, { headers: { "Cache-Control": "no-store" } }),
            ),
        }).mintChildRunEventWriterCapability("run_child"),
      HostedChildRunEventWriterTokenExchangeError,
      "Unable to initialize durable child event persistence",
    );
  });
}

Deno.test("mintChildRunEventWriterCapability maps aborts to a sanitized error", async () => {
  const controller = new AbortController();
  controller.abort("parent-writer-token-must-not-leak");

  const error = await assertRejects(
    () =>
      createHostedRunEventWriterCapability({
        apiUrl: "https://api.example.com",
        runId: "run_parent",
        runEventAppendToken: "parent-writer-token",
        fetch: (input, init) => Promise.reject(new Request(input, init).signal.reason),
      }).mintChildRunEventWriterCapability("run_child", controller.signal),
    HostedChildRunEventWriterTokenExchangeError,
    "Unable to initialize durable child event persistence",
  );

  assertEquals(
    error instanceof Error && error.message.includes("parent-writer-token"),
    false,
  );
  assertEquals(
    error instanceof HostedChildRunEventWriterTokenExchangeError && error.classification,
    "aborted",
  );
});

Deno.test("mintChildRunEventWriterCapability applies a bounded timeout", async () => {
  const error = await assertRejects(
    () =>
      createHostedRunEventWriterCapability({
        apiUrl: "https://api.example.com",
        runId: "run_parent",
        runEventAppendToken: "parent-writer-token",
        timeoutMs: 1,
        fetch: (input, init) => {
          const signal = new Request(input, init).signal;
          return new Promise<Response>((_resolve, reject) => {
            signal.addEventListener("abort", () => reject(signal.reason), { once: true });
          });
        },
      }).mintChildRunEventWriterCapability("run_child"),
    HostedChildRunEventWriterTokenExchangeError,
    "Unable to initialize durable child event persistence",
  );

  assertEquals(error instanceof Error && error.message.includes("parent-writer-token"), false);
  assertEquals(
    error instanceof HostedChildRunEventWriterTokenExchangeError && error.classification,
    "timeout",
  );
});

Deno.test("mintChildRunEventWriterCapability keeps the first cancellation classification", async () => {
  const controller = new AbortController();
  const callerAbort = setTimeout(
    () => controller.abort("parent-writer-token-must-not-leak"),
    20,
  );
  try {
    const error = await assertRejects(
      () =>
        createHostedRunEventWriterCapability({
          apiUrl: "https://api.example.com",
          runId: "run_parent",
          runEventAppendToken: "parent-writer-token",
          timeoutMs: 1,
          fetch: (input, init) => {
            const signal = new Request(input, init).signal;
            return new Promise<Response>((_resolve, reject) => {
              signal.addEventListener("abort", () => reject(signal.reason), { once: true });
            });
          },
        }).mintChildRunEventWriterCapability("run_child", controller.signal),
      HostedChildRunEventWriterTokenExchangeError,
      "Unable to initialize durable child event persistence",
    );

    assertEquals(
      error instanceof HostedChildRunEventWriterTokenExchangeError && error.classification,
      "timeout",
    );
  } finally {
    clearTimeout(callerAbort);
  }
});

Deno.test("writer capabilities keep credentials private after shared-realm poisoning", async () => {
  const rootToken = "root-writer-token-must-stay-private";
  const childToken = "child-writer-token-must-stay-private";
  const conversationId = "11111111-1111-4111-a111-111111111111";
  const trustedAuthorizations: Array<string | null> = [];
  const trustedFetch: typeof fetch = (input, init) => {
    const request = new Request(input, init);
    trustedAuthorizations.push(request.headers.get("Authorization"));
    if (request.url.endsWith("/event-writer-token")) {
      return Promise.resolve(
        Response.json(
          { run_event_token: childToken },
          { headers: { "Cache-Control": "no-store" } },
        ),
      );
    }
    return Promise.resolve(Response.json({
      latestEventId: 1,
      latestExternalEventSequence: 1,
      appendedCount: 1,
      run: {
        runId: "run_child",
        conversationId,
        latestEventId: 1,
        latestExternalEventSequence: 1,
      },
    }));
  };

  const originalFetch = globalThis.fetch;
  globalThis.fetch = trustedFetch;
  const freshModule = await import(
    "./child-run-event-writer-token.ts?shared-realm-poisoning"
  );

  const nativeApply = Reflect.apply;
  const nativeWeakMapGet = WeakMap.prototype.get;
  const nativeWeakMapSet = WeakMap.prototype.set;
  const nativeAlsGetStore = AsyncLocalStorage.prototype.getStore;
  const nativeAlsRun = AsyncLocalStorage.prototype.run;
  const nativeTrim = String.prototype.trim;
  const nativeSplit = String.prototype.split;
  const nativeToLowerCase = String.prototype.toLowerCase;
  const nativeStringValueOf = String.prototype.valueOf;
  const nativeEncode = TextEncoder.prototype.encode;
  const nativeJsonParse = JSON.parse;
  const nativeObjectKeys = Object.keys;
  const nativeHasOwnProperty = Object.prototype.hasOwnProperty;
  const nativeArrayIsArray = Array.isArray;
  const observations = {
    weakMapMethod: 0,
    weakMapSecret: 0,
    asyncScope: 0,
    stringDirective: 0,
    tokenTrim: 0,
    tokenEncode: 0,
    childJson: 0,
    childObject: 0,
    poisonedFetch: 0,
  };

  const inspectSecretRecord = (value: unknown) => {
    if (typeof value !== "object" || value === null) return;
    const record = value as Record<string, unknown>;
    if (record.runEventAppendToken === rootToken || record.runEventAppendToken === childToken) {
      observations.weakMapSecret += 1;
    }
    if (record.token === rootToken || record.token === childToken) {
      observations.weakMapSecret += 1;
    }
  };

  try {
    WeakMap.prototype.get = function (key: WeakKey) {
      observations.weakMapMethod += 1;
      return nativeApply(nativeWeakMapGet, this, [key]);
    };
    WeakMap.prototype.set = function (key: WeakKey, value: unknown) {
      observations.weakMapMethod += 1;
      inspectSecretRecord(value);
      return nativeApply(nativeWeakMapSet, this, [key, value]);
    };
    AsyncLocalStorage.prototype.getStore = function () {
      observations.asyncScope += 1;
      return nativeApply(nativeAlsGetStore, this, []);
    };
    AsyncLocalStorage.prototype.run = function <R, TArgs extends unknown[]>(
      store: unknown,
      callback: (...args: TArgs) => R,
      ...args: TArgs
    ): R {
      observations.asyncScope += 1;
      return nativeApply(nativeAlsRun, this, [store, callback, ...args]) as R;
    };
    String.prototype.trim = function () {
      const value = nativeApply(nativeStringValueOf, this, []) as string;
      if (value === rootToken || value === childToken) observations.tokenTrim += 1;
      return nativeApply(nativeTrim, this, []) as string;
    };
    String.prototype.split = (function (
      this: string,
      separator?: unknown,
      limit?: number,
    ) {
      observations.stringDirective += 1;
      return nativeApply(nativeSplit, this, [separator, limit]) as string[];
    }) as typeof String.prototype.split;
    String.prototype.toLowerCase = function () {
      observations.stringDirective += 1;
      return nativeApply(nativeToLowerCase, this, []) as string;
    };
    TextEncoder.prototype.encode = (function (this: TextEncoder, input = "") {
      if (input === rootToken || input === childToken) observations.tokenEncode += 1;
      return nativeApply(nativeEncode, this, [input]) as Uint8Array;
    }) as typeof TextEncoder.prototype.encode;
    JSON.parse =
      ((text: string, reviver?: (this: unknown, key: string, value: unknown) => unknown) => {
        if (text.includes(childToken)) observations.childJson += 1;
        return nativeApply(nativeJsonParse, JSON, [text, reviver]);
      }) as typeof JSON.parse;
    Object.keys = ((value: object) => {
      inspectSecretRecord(value);
      if (
        typeof value === "object" && value !== null &&
        (value as Record<string, unknown>).run_event_token === childToken
      ) {
        observations.childObject += 1;
      }
      return nativeApply(nativeObjectKeys, Object, [value]) as string[];
    }) as typeof Object.keys;
    Object.prototype.hasOwnProperty = function (property: PropertyKey) {
      if (
        property === "run_event_token" &&
        (this as Record<string, unknown>).run_event_token === childToken
      ) {
        observations.childObject += 1;
      }
      return nativeApply(nativeHasOwnProperty, this, [property]) as boolean;
    };
    Array.isArray = ((value: unknown) => {
      inspectSecretRecord(value);
      return nativeApply(nativeArrayIsArray, Array, [value]) as boolean;
    }) as typeof Array.isArray;
    globalThis.fetch = (() => {
      observations.poisonedFetch += 1;
      return Promise.reject(new Error("poisoned global fetch must not run"));
    }) as typeof fetch;
    Reflect.apply = (() => {
      throw new Error("poisoned Reflect.apply must not run");
    }) as typeof Reflect.apply;

    const verifiedRequest = {
      projectId: "project-1",
      durableRootRun: { runId: "run_parent" },
    };
    freshModule.registerHostedRunEventWriterToken(verifiedRequest, {
      token: rootToken,
      projectId: "project-1",
      runId: "run_parent",
    });
    const ingressCapability = await freshModule.runWithVerifiedHostedRunEventWriterRequest(
      verifiedRequest,
      () =>
        freshModule.createHostedRunEventWriterCapabilityForRequest(
          { ...verifiedRequest },
          { apiUrl: "https://api.example.test", runId: "run_parent" },
        ),
    );
    if (!ingressCapability) {
      throw new Error("Expected verified ingress to create exact-root writer authority");
    }

    const parentCapability = freshModule.createHostedRunEventWriterCapability({
      apiUrl: "https://api.example.test",
      runId: "run_parent",
      runEventAppendToken: rootToken,
    });
    const childCapability = await parentCapability.mintChildRunEventWriterCapability(
      "run_child",
    );
    await freshModule.runWithHostedRunEventWriterCapability(childCapability, async () => {
      if (freshModule.getActiveHostedRunEventWriterCapability() !== childCapability) {
        throw new Error("Expected exact child authority inside its bounded host scope");
      }
    });
    const mirror = freshModule.createHostedConversationRunChunkMirrorFromCapability(
      childCapability,
      {
        expectedRunId: "run_child",
        conversationId,
        latestEventId: 0,
        latestExternalEventSequence: 0,
      },
    );
    if (!mirror) throw new Error("Expected an exact-child capability-backed mirror");
    await mirror.appendEvents([{ type: "TEXT_MESSAGE_CONTENT", delta: "persisted" }]);
    await mirror.flush();
    mirror.dispose();
  } finally {
    Reflect.apply = nativeApply;
    WeakMap.prototype.get = nativeWeakMapGet;
    WeakMap.prototype.set = nativeWeakMapSet;
    AsyncLocalStorage.prototype.getStore = nativeAlsGetStore;
    AsyncLocalStorage.prototype.run = nativeAlsRun;
    String.prototype.trim = nativeTrim;
    String.prototype.split = nativeSplit;
    String.prototype.toLowerCase = nativeToLowerCase;
    TextEncoder.prototype.encode = nativeEncode;
    JSON.parse = nativeJsonParse;
    Object.keys = nativeObjectKeys;
    Object.prototype.hasOwnProperty = nativeHasOwnProperty;
    Array.isArray = nativeArrayIsArray;
    globalThis.fetch = originalFetch;
  }

  assertEquals(observations, {
    weakMapMethod: 0,
    weakMapSecret: 0,
    asyncScope: 0,
    stringDirective: 0,
    tokenTrim: 0,
    tokenEncode: 0,
    childJson: 0,
    childObject: 0,
    poisonedFetch: 0,
  });
  assertEquals(trustedAuthorizations, [`Bearer ${rootToken}`, `Bearer ${childToken}`]);
});

Deno.test("verified request tokens never mint writer authority for a different runId", () => {
  const request = { projectId: "project-1", durableRootRun: { runId: "run_parent" } };
  registerHostedRunEventWriterToken(request, {
    projectId: "project-1",
    runId: "run_parent",
    token: "root-token",
  });

  assertEquals(
    createHostedRunEventWriterCapabilityForRequest(request, {
      apiUrl: "https://api.example.test",
      runId: "run_other",
    }),
    undefined,
    "a verified token must not mint authority for a different runId",
  );
  assertEquals(
    typeof createHostedRunEventWriterCapabilityForRequest(request, {
      apiUrl: "https://api.example.test",
      runId: "run_parent",
    })?.mintChildRunEventWriterCapability,
    "function",
    "the exact verified runId must still mint authority",
  );
});

Deno.test("ambient verified writer reuse requires a matching projectId", async () => {
  const request = { projectId: "project-1", durableRootRun: { runId: "run_parent" } };
  registerHostedRunEventWriterToken(request, {
    projectId: "project-1",
    runId: "run_parent",
    token: "root-token",
  });

  await runWithVerifiedHostedRunEventWriterRequest(request, () => {
    assertEquals(
      createHostedRunEventWriterCapabilityForRequest(
        { ...request, projectId: "project_other" },
        { apiUrl: "https://api.example.test", runId: "run_parent" },
      ),
      undefined,
      "ambient reuse must require a matching projectId",
    );
    assertEquals(
      typeof createHostedRunEventWriterCapabilityForRequest(
        { ...request },
        { apiUrl: "https://api.example.test", runId: "run_parent" },
      )?.mintChildRunEventWriterCapability,
      "function",
      "an identity-preserving clone must reuse the verified writer",
    );
  });
});

Deno.test("ambient verified writer reuse requires a matching durable root runId", async () => {
  const request = { projectId: "project-1", durableRootRun: { runId: "run_parent" } };
  registerHostedRunEventWriterToken(request, {
    projectId: "project-1",
    runId: "run_parent",
    token: "root-token",
  });

  await runWithVerifiedHostedRunEventWriterRequest(request, () => {
    assertEquals(
      createHostedRunEventWriterCapabilityForRequest(
        { ...request, durableRootRun: { runId: "run_other" } },
        { apiUrl: "https://api.example.test", runId: "run_parent" },
      ),
      undefined,
      "ambient reuse must require a matching durable root runId",
    );
    assertEquals(
      createHostedRunEventWriterCapabilityForRequest(
        { ...request, durableRootRun: { runId: "run_other" } },
        { apiUrl: "https://api.example.test", runId: "run_other" },
      ),
      undefined,
      "a mismatched clone must not mint authority for the runId it names either",
    );
  });
});
