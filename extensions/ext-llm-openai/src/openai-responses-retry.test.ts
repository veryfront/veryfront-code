import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  ProviderOverloadedError,
  ProviderQuotaError,
  ProviderRequestError,
  ProviderStreamProtocolError,
} from "veryfront/provider/shared";
import { createOpenAIResponsesRuntime } from "./openai-provider.ts";

const prompt = [{ role: "user", content: [{ type: "text", text: "Hi" }] }] as const;
const success = [
  { type: "response.output_item.added", item: { id: "m", type: "message" } },
  { type: "response.output_text.delta", item_id: "m", delta: "ok" },
  {
    type: "response.output_item.done",
    item: {
      id: "m",
      type: "message",
      role: "assistant",
      content: [{ type: "output_text", text: "ok" }],
    },
  },
  { type: "response.completed", response: { status: "completed" } },
];

function response(events: unknown[]): Response {
  return new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""), {
    headers: { "content-type": "text/event-stream" },
  });
}

async function collect(stream: ReadableStream<unknown>): Promise<unknown[]> {
  const parts = [];
  for await (const part of stream) parts.push(part);
  return parts;
}

describe("OpenAI Responses pre-output retry", () => {
  it("replays only the unchanged request on transient flat or nested errors", async () => {
    for (
      const fields of [{ code: "server_error", message: "private" }, {
        error: { code: "rate_limit_exceeded", message: "private" },
      }]
    ) {
      const requests: { url: string; body: unknown; authorization: string | null }[] = [];
      const runtime = createOpenAIResponsesRuntime({
        apiKey: "owned-key",
        baseURL: "https://provider.test/v1",
        fetch: (url, init) => {
          requests.push({
            url: String(url),
            body: init && "body" in init ? init.body : undefined,
            authorization: new Headers(init && "headers" in init ? init.headers : undefined).get(
              "authorization",
            ),
          });
          return Promise.resolve(
            response(requests.length === 1 ? [{ type: "error", ...fields }] : success),
          );
        },
      }, "owned-model");
      const result = await runtime.doStream({ prompt: [...prompt] });
      const parts = await collect(result.stream);
      assertEquals(requests.length, 2);
      assertEquals(requests[1], requests[0]);
      assertEquals(parts.filter((part) => (part as { type: string }).type === "finish").length, 1);
    }
  });

  it("surfaces the original error after two pre-output replays", async () => {
    let attempts = 0;
    const runtime = createOpenAIResponsesRuntime({
      apiKey: "k",
      fetch: () => {
        attempts++;
        return Promise.resolve(
          response([{ type: "error", code: "server_error", message: "private" }]),
        );
      },
    }, "model");
    const result = await runtime.doStream({ prompt: [...prompt] });
    await assertRejects(() => collect(result.stream), ProviderOverloadedError);
    assertEquals(attempts, 3);
  });

  it("never replays permanent errors or errors after the first yielded part", async () => {
    for (
      const [events, ErrorClass] of [
        [[{ type: "error", code: "insufficient_quota", message: "private" }], ProviderQuotaError],
        [[{ type: "error", code: "unknown", message: "private" }], ProviderRequestError],
        [[{ type: "error", error: null }], ProviderStreamProtocolError],
        [
          [...success.slice(0, 2), { type: "error", code: "server_error", message: "private" }],
          ProviderOverloadedError,
        ],
      ] as const
    ) {
      let attempts = 0;
      const runtime = createOpenAIResponsesRuntime({
        apiKey: "k",
        fetch: () => {
          attempts++;
          return Promise.resolve(response([...events]));
        },
      }, "model");
      const result = await runtime.doStream({ prompt: [...prompt] });
      await assertRejects(
        () => collect(result.stream),
        ErrorClass,
      );
      assertEquals(attempts, 1);
    }
  });

  it("cancellation during backoff prevents a second request", async () => {
    const caller = new AbortController();
    let attempts = 0;
    const reason = new Error("caller stopped");
    const runtime = createOpenAIResponsesRuntime({
      apiKey: "k",
      fetch: () => {
        attempts++;
        setTimeout(() => caller.abort(reason), 0);
        return Promise.resolve(
          response([{ type: "error", code: "server_error", message: "private" }]),
        );
      },
    }, "model");
    const result = await runtime.doStream({ prompt: [...prompt], abortSignal: caller.signal });
    const error = await assertRejects(() => collect(result.stream));
    assertEquals(error, reason);
    assertEquals(attempts, 1);
  });
  it("preserves the shared deadline before and after backoff", async () => {
    const original = Object.getOwnPropertyDescriptor(performance, "now");
    try {
      for (const expireDuringBackoff of [false, true]) {
        let clock = 0;
        Object.defineProperty(performance, "now", { configurable: true, value: () => clock });
        let attempts = 0;
        const runtime = createOpenAIResponsesRuntime({
          apiKey: "k",
          fetch: () => {
            attempts++;
            clock = expireDuringBackoff ? 38_500 : 39_500;
            if (expireDuringBackoff) {
              setTimeout(() => {
                clock = 40_001;
              }, 0);
            }
            return Promise.resolve(
              response([{ type: "error", code: "server_error", message: "private" }]),
            );
          },
        }, "model");
        const result = await runtime.doStream({ prompt: [...prompt] });
        await assertRejects(() => collect(result.stream), ProviderOverloadedError);
        assertEquals(attempts, 1);
      }
    } finally {
      if (original) Object.defineProperty(performance, "now", original);
      else Reflect.deleteProperty(performance, "now");
    }
  });

  it("cancels the failed response body before issuing its replay", async () => {
    let attempts = 0;
    let cancellations = 0;
    const runtime = createOpenAIResponsesRuntime({
      apiKey: "k",
      fetch: () => {
        attempts++;
        if (attempts > 1) {
          assertEquals(cancellations, 1);
          return Promise.resolve(response(success));
        }
        return Promise.resolve(
          new Response(
            new ReadableStream<Uint8Array>({
              start(controller) {
                controller.enqueue(
                  new TextEncoder().encode(
                    'data: {"type":"error","code":"server_error","message":"private"}\n\n',
                  ),
                );
              },
              cancel() {
                cancellations++;
              },
            }),
            { headers: { "content-type": "text/event-stream" } },
          ),
        );
      },
    }, "model");
    const result = await runtime.doStream({ prompt: [...prompt] });
    await collect(result.stream);
    assertEquals(attempts, 2);
    assertEquals(cancellations, 1);
  });
});
