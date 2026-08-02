import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import {
  createHostedRunEventWriterCapability,
  getActiveHostedRunEventWriterCapability,
  HostedChildRunEventWriterTokenExchangeError,
  runWithHostedRunEventWriterCapability,
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
      assertEquals(detachedCapability?.mintChildRunEventAppendToken, undefined);
    });

    assertEquals(getActiveHostedRunEventWriterCapability(), capability);
    await Promise.resolve();
    assertEquals(getActiveHostedRunEventWriterCapability(), capability);
  });

  assertEquals(getActiveHostedRunEventWriterCapability(), undefined);
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
  const childCapability = await capability.mintChildRunEventAppendToken("run_child");
  const grandchildCapability = await childCapability.mintChildRunEventAppendToken(
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

  await capability.mintChildRunEventAppendToken("run_child");

  assertEquals(
    requestUrl,
    "https://api.example.test/v1/runs/run_parent/children/run_child/event-writer-token",
  );
});

Deno.test("mintChildRunEventAppendToken rejects responses without no-store", async () => {
  await assertRejects(
    () =>
      createHostedRunEventWriterCapability({
        apiUrl: "https://api.example.com",
        runId: "run_parent",
        runEventAppendToken: "parent-writer-token",
        fetch: () => Promise.resolve(Response.json({ run_event_token: "child-writer-token" })),
      }).mintChildRunEventAppendToken("run_child"),
    HostedChildRunEventWriterTokenExchangeError,
    "Unable to initialize durable child event persistence",
  );
});

Deno.test("mintChildRunEventAppendToken rejects control-plane errors without reading their body", async () => {
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
      }).mintChildRunEventAppendToken("run_child"),
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
  Deno.test(`mintChildRunEventAppendToken rejects invalid response ${JSON.stringify(body)}`, async () => {
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
        }).mintChildRunEventAppendToken("run_child"),
      HostedChildRunEventWriterTokenExchangeError,
      "Unable to initialize durable child event persistence",
    );
  });
}

Deno.test("mintChildRunEventAppendToken maps aborts to a sanitized error", async () => {
  const controller = new AbortController();
  controller.abort("parent-writer-token-must-not-leak");

  const error = await assertRejects(
    () =>
      createHostedRunEventWriterCapability({
        apiUrl: "https://api.example.com",
        runId: "run_parent",
        runEventAppendToken: "parent-writer-token",
        fetch: (input, init) => Promise.reject(new Request(input, init).signal.reason),
      }).mintChildRunEventAppendToken("run_child", controller.signal),
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

Deno.test("mintChildRunEventAppendToken applies a bounded timeout", async () => {
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
      }).mintChildRunEventAppendToken("run_child"),
    HostedChildRunEventWriterTokenExchangeError,
    "Unable to initialize durable child event persistence",
  );

  assertEquals(error instanceof Error && error.message.includes("parent-writer-token"), false);
  assertEquals(
    error instanceof HostedChildRunEventWriterTokenExchangeError && error.classification,
    "timeout",
  );
});

Deno.test("mintChildRunEventAppendToken keeps the first cancellation classification", async () => {
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
        }).mintChildRunEventAppendToken("run_child", controller.signal),
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
