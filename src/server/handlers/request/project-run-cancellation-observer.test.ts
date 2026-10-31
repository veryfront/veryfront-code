import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  observeProjectRunCancellation,
  readRunStopObserverExpiry,
} from "./project-run-cancellation-observer.ts";

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
async function until(check: () => boolean): Promise<void> {
  const end = Date.now() + 2_000;
  while (!check() && Date.now() < end) await sleep(5);
  assertEquals(check(), true);
}
function watch(fetcher: typeof fetch, stopped: () => void, requestTimeoutMs = 500) {
  return observeProjectRunCancellation({
    fetch: fetcher,
    url: "https://api.example.test/runs/run-1/cancellation-status",
    token: "attempt-stop-token",
    expiresAt: Date.now() + 60_000,
    onStopRequested: stopped,
    pollIntervalMs: 10,
    requestTimeoutMs,
  });
}

describe("project run cancellation observer", () => {
  it("reads only a bounded expiry hint and rejects absent or malformed JWT expiry", () => {
    const token = (payload: unknown) => `header.${btoa(JSON.stringify(payload))}.signature`;
    assertEquals(readRunStopObserverExpiry(token({ exp: 123 })), 123_000);
    for (
      const value of [
        "opaque",
        "header.!.signature",
        token({}),
        token({ exp: "123" }),
        token({ exp: 1e100 }),
        "x".repeat(16_385),
      ]
    ) {
      assertEquals(readRunStopObserverExpiry(value), undefined);
    }
  });

  it("does not poll an expired capability", async () => {
    let calls = 0;
    const dispose = observeProjectRunCancellation({
      fetch: async () => {
        calls++;
        return Response.json({ stopRequested: true });
      },
      url: "https://api.example.test/runs/run-1/cancellation-status",
      token: "expired",
      expiresAt: Date.now() - 1,
      onStopRequested: () => {
        throw new Error("expired stop");
      },
    });
    await sleep(20);
    dispose();
    assertEquals(calls, 0);
  });

  it("ignores a response arriving after the capability expires", async () => {
    const pending = Promise.withResolvers<Response>();
    let calls = 0;
    let stops = 0;
    const dispose = observeProjectRunCancellation({
      fetch: async () => {
        calls++;
        return await pending.promise;
      },
      url: "https://api.example.test/runs/run-1/cancellation-status",
      token: "expires",
      expiresAt: Date.now() + 30,
      onStopRequested: () => stops++,
      requestTimeoutMs: 500,
    });
    await sleep(60);
    pending.resolve(Response.json({ stopRequested: true }));
    await sleep(20);
    dispose();
    assertEquals(calls, 1);
    assertEquals(stops, 0);
  });

  it("polls with only the stop capability and aborts once on exact affirmative JSON", async () => {
    let calls = 0;
    let stops = 0;
    const dispose = watch(async (url, init) => {
      calls++;
      assertEquals(url, "https://api.example.test/runs/run-1/cancellation-status");
      assertEquals(init?.method, "GET");
      assertEquals(init?.redirect, "error");
      assertEquals(new Headers(init?.headers).get("authorization"), "Bearer attempt-stop-token");
      return Response.json({ stopRequested: calls > 1 });
    }, () => stops++);
    try {
      await until(() => stops === 1);
      await sleep(40);
      assertEquals(calls, 2);
      assertEquals(stops, 1);
    } finally {
      dispose();
    }
  });

  for (
    const response of [
      () => Response.json({ stopRequested: true }, { status: 401 }),
      () => Response.json({ stopRequested: true }, { status: 403 }),
      () => Response.json({ stopRequested: true }, { status: 500 }),
      () => new Response("not JSON"),
      () => Response.json({ stopRequested: "true" }),
      () => Response.json({ stopRequested: true, extra: true }),
      () => Response.json({}),
      () => new Response(" ".repeat(300) + '{"stopRequested":true}'),
      () => {
        throw new Error("network unavailable");
      },
    ]
  ) {
    it(`fails closed and can recover after invalid response ${response.toString()}`, async () => {
      let calls = 0;
      let stops = 0;
      const dispose = watch(
        async () => ++calls === 1 ? response() : Response.json({ stopRequested: true }),
        () => stops++,
      );
      try {
        await until(() => calls >= 2);
        await until(() => stops === 1);
        assertEquals(stops, 1);
      } finally {
        dispose();
      }
    });
  }

  it("disables on 404 for older APIs", async () => {
    let calls = 0;
    let stops = 0;
    const dispose = watch(async () => {
      calls++;
      return new Response(null, { status: 404 });
    }, () => stops++);
    try {
      await until(() => calls === 1);
      await sleep(50);
      assertEquals(calls, 1);
      assertEquals(stops, 0);
    } finally {
      dispose();
    }
  });

  it("keeps one request in flight and ignores a late affirmative after its deadline", async () => {
    const pending = Promise.withResolvers<Response>();
    let calls = 0;
    let stops = 0;
    let signal: AbortSignal | null | undefined;
    const dispose = watch(
      async (_url, init) => {
        calls++;
        signal = init?.signal;
        return calls === 1 ? await pending.promise : Response.json({ stopRequested: false });
      },
      () => stops++,
      30,
    );
    try {
      await until(() => calls === 1);
      await sleep(80);
      assertExists(signal);
      assertEquals(signal.aborted, true);
      assertEquals(calls, 1);
      pending.resolve(Response.json({ stopRequested: true }));
      await until(() => calls >= 2);
      assertEquals(stops, 0);
    } finally {
      pending.resolve(Response.json({ stopRequested: false }));
      dispose();
    }
  });

  it("disposes an active read and ignores an affirmative response arriving after settlement", async () => {
    const pending = Promise.withResolvers<Response>();
    let calls = 0;
    let stops = 0;
    const dispose = watch(async () => {
      calls++;
      return await pending.promise;
    }, () => stops++);
    await until(() => calls === 1);
    dispose();
    pending.resolve(Response.json({ stopRequested: true }));
    await sleep(40);
    assertEquals(stops, 0);
    assertEquals(calls, 1);
  });

  it("bounds a response body that never ends and cancels its reader", async () => {
    let cancelled = false;
    let calls = 0;
    let stops = 0;
    const dispose = watch(
      async () => {
        calls++;
        return calls === 1
          ? new Response(
            new ReadableStream({
              start(controller) {
                controller.enqueue(new TextEncoder().encode('{"stopRequested":'));
              },
              cancel() {
                cancelled = true;
              },
            }),
          )
          : Response.json({ stopRequested: false });
      },
      () => stops++,
      30,
    );
    try {
      await until(() => cancelled);
      await until(() => calls >= 2);
      assertEquals(stops, 0);
    } finally {
      dispose();
    }
  });
});
