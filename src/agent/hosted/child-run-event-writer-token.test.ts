import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import {
  exchangeHostedChildRunEventWriterToken,
  HostedChildRunEventWriterTokenExchangeError,
} from "./child-run-event-writer-token.ts";

Deno.test("exchangeHostedChildRunEventWriterToken uses the active parent writer token without a body", async () => {
  let request: Request | undefined;

  const token = await exchangeHostedChildRunEventWriterToken({
    apiUrl: "https://api.example.com/",
    parentRunId: "run_parent",
    childRunId: "run_child",
    runEventAppendToken: "parent-writer-token",
    fetch: (input, init) => {
      request = new Request(input, init);
      return Promise.resolve(
        Response.json(
          { run_event_token: "child-writer-token" },
          { headers: { "Cache-Control": "no-store" } },
        ),
      );
    },
  });

  assertEquals(token, "child-writer-token");
  assertEquals(
    request?.url,
    "https://api.example.com/runs/run_parent/children/run_child/event-writer-token",
  );
  assertEquals(request?.method, "POST");
  assertEquals(request?.headers.get("Authorization"), "Bearer parent-writer-token");
  assertEquals(request?.headers.get("Cache-Control"), "no-store");
  assertEquals(await request?.text(), "");
});

Deno.test("exchangeHostedChildRunEventWriterToken rejects responses without no-store", async () => {
  await assertRejects(
    () =>
      exchangeHostedChildRunEventWriterToken({
        apiUrl: "https://api.example.com",
        parentRunId: "run_parent",
        childRunId: "run_child",
        runEventAppendToken: "parent-writer-token",
        fetch: () => Promise.resolve(Response.json({ run_event_token: "child-writer-token" })),
      }),
    HostedChildRunEventWriterTokenExchangeError,
    "Unable to initialize durable child event persistence",
  );
});

Deno.test("exchangeHostedChildRunEventWriterToken rejects control-plane errors without reading their body", async () => {
  let bodyRead = false;
  const response = new Response("parent-writer-token-must-not-leak", { status: 503 });
  const originalJson = response.json.bind(response);
  response.json = () => {
    bodyRead = true;
    return originalJson();
  };

  await assertRejects(
    () =>
      exchangeHostedChildRunEventWriterToken({
        apiUrl: "https://api.example.com",
        parentRunId: "run_parent",
        childRunId: "run_child",
        runEventAppendToken: "parent-writer-token",
        fetch: () => Promise.resolve(response),
      }),
    HostedChildRunEventWriterTokenExchangeError,
    "Unable to initialize durable child event persistence",
  );
  assertEquals(bodyRead, false);
});

for (
  const body of [
    {},
    { run_event_token: "" },
    { run_event_token: 1 },
    { run_event_token: "child-writer-token", extra: true },
  ]
) {
  Deno.test(`exchangeHostedChildRunEventWriterToken rejects invalid response ${JSON.stringify(body)}`, async () => {
    await assertRejects(
      () =>
        exchangeHostedChildRunEventWriterToken({
          apiUrl: "https://api.example.com",
          parentRunId: "run_parent",
          childRunId: "run_child",
          runEventAppendToken: "parent-writer-token",
          fetch: () =>
            Promise.resolve(
              Response.json(body, { headers: { "Cache-Control": "no-store" } }),
            ),
        }),
      HostedChildRunEventWriterTokenExchangeError,
      "Unable to initialize durable child event persistence",
    );
  });
}

Deno.test("exchangeHostedChildRunEventWriterToken maps aborts to a sanitized error", async () => {
  const controller = new AbortController();
  controller.abort("parent-writer-token-must-not-leak");

  const error = await assertRejects(
    () =>
      exchangeHostedChildRunEventWriterToken({
        apiUrl: "https://api.example.com",
        parentRunId: "run_parent",
        childRunId: "run_child",
        runEventAppendToken: "parent-writer-token",
        abortSignal: controller.signal,
        fetch: (input, init) => Promise.reject(new Request(input, init).signal.reason),
      }),
    HostedChildRunEventWriterTokenExchangeError,
    "Unable to initialize durable child event persistence",
  );

  assertEquals(
    error instanceof Error && error.message.includes("parent-writer-token"),
    false,
  );
});

Deno.test("exchangeHostedChildRunEventWriterToken applies a bounded timeout", async () => {
  const error = await assertRejects(
    () =>
      exchangeHostedChildRunEventWriterToken({
        apiUrl: "https://api.example.com",
        parentRunId: "run_parent",
        childRunId: "run_child",
        runEventAppendToken: "parent-writer-token",
        timeoutMs: 1,
        fetch: (input, init) => {
          const signal = new Request(input, init).signal;
          return new Promise<Response>((_resolve, reject) => {
            signal.addEventListener("abort", () => reject(signal.reason), { once: true });
          });
        },
      }),
    HostedChildRunEventWriterTokenExchangeError,
    "Unable to initialize durable child event persistence",
  );

  assertEquals(error instanceof Error && error.message.includes("parent-writer-token"), false);
});
