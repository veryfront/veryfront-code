import {
  assert,
  assertEquals,
  assertFalse,
  assertRejects,
  assertStringIncludes,
} from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import {
  expectJsonArray,
  expectJsonObject,
  LatestRequestOwner,
  requestJson,
  runOwnedRequest,
} from "./browser-request.ts";

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function deferred<T>(): {
  readonly promise: Promise<T>;
  resolve(value: T): void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe("requestJson", () => {
  it("rejects non-success, malformed, invalid-shape, and oversized responses", async () => {
    const error = await assertRejects(() =>
      requestJson("https://local.test/api", {
        responseLabel: "Projects",
        admit: (value) => value,
        fetchImpl: () => Promise.resolve(jsonResponse({ error: "denied", hint: "reload" }, 403)),
      })
    );
    const message = error instanceof Error ? error.message : String(error);
    assertStringIncludes(message, "HTTP 403");
    assertStringIncludes(message, "denied\n\nreload");

    await assertRejects(
      () =>
        requestJson("https://local.test/api", {
          responseLabel: "Projects",
          admit: (value) => value,
          fetchImpl: () => Promise.resolve(new Response("<html>", { status: 200 })),
        }),
      TypeError,
      "malformed JSON",
    );

    await assertRejects(
      () =>
        requestJson("https://local.test/api", {
          responseLabel: "Projects",
          admit: (value) => {
            const record = expectJsonObject(value, "projects response");
            return expectJsonArray(record.data, "projects", 2);
          },
          fetchImpl: () => Promise.resolve(jsonResponse({ data: "not-an-array" })),
        }),
      TypeError,
      "invalid response",
    );

    await assertRejects(
      () =>
        requestJson("https://local.test/api", {
          responseLabel: "Projects",
          admit: (value) => value,
          maxResponseBytes: 4,
          fetchImpl: () => Promise.resolve(jsonResponse({ data: [] })),
        }),
      RangeError,
      "exceeds 4 bytes",
    );

    await assertRejects(
      () =>
        requestJson("https://local.test/api", {
          responseLabel: "Projects",
          admit: (value) => value,
          fetchImpl: () => Promise.resolve(new Response(new Uint8Array([0xff]))),
        }),
      TypeError,
      "invalid UTF-8",
    );
  });
});

describe("LatestRequestOwner", () => {
  it("prevents a superseded fetch from publishing or finalizing state", async () => {
    const first = deferred<Response>();
    const second = deferred<Response>();
    const responses = [first, second];
    const signals: AbortSignal[] = [];
    const fetchImpl: typeof globalThis.fetch = (_input, init) => {
      assert(init?.signal instanceof AbortSignal);
      signals.push(init.signal);
      return responses.shift()!.promise;
    };
    const owner = new LatestRequestOwner();
    const visible: string[] = [];
    const finished: string[] = [];

    const run = (label: string): Promise<void> =>
      runOwnedRequest(
        owner,
        (signal) =>
          requestJson("https://local.test/api", {
            responseLabel: label,
            admit: (value) => expectJsonObject(value, label).value as string,
            init: { signal },
            fetchImpl,
          }),
        {
          success: (value) => visible.push(value),
          error: (error) => {
            throw error;
          },
          finish: () => finished.push(label),
        },
      );

    const oldRun = run("old");
    const newRun = run("new");
    assertEquals(signals.length, 2);
    assertEquals(signals[0]?.aborted, true);
    assertEquals(signals[1]?.aborted, false);

    second.resolve(jsonResponse({ value: "new" }));
    await newRun;
    assertEquals(signals[1]?.aborted, true);
    first.resolve(jsonResponse({ value: "old" }));
    await oldRun;

    assertEquals(visible, ["new"]);
    assertEquals(finished, ["new"]);
    assertFalse(owner.busy);
  });

  it("skips polling ticks while a prior generation is in flight", async () => {
    const response = deferred<Response>();
    let fetchCalls = 0;
    const fetchImpl: typeof globalThis.fetch = () => {
      fetchCalls += 1;
      return response.promise;
    };
    const owner = new LatestRequestOwner();
    const operation = (signal: AbortSignal) =>
      requestJson("https://local.test/api", {
        responseLabel: "Runtime metrics",
        admit: (value) => value,
        init: { signal },
        fetchImpl,
      });
    const observers = {
      success() {},
      error(error: unknown) {
        throw error;
      },
    };

    const firstRun = runOwnedRequest(owner, operation, observers, "skip-while-busy");
    await runOwnedRequest(owner, operation, observers, "skip-while-busy");
    assertEquals(fetchCalls, 1);

    response.resolve(jsonResponse({ counters: {} }));
    await firstRun;
    assertFalse(owner.busy);
  });

  it("revokes a late response after component-style cancellation", async () => {
    const response = deferred<Response>();
    const signals: AbortSignal[] = [];
    const fetchImpl: typeof globalThis.fetch = (_input, init) => {
      assert(init?.signal instanceof AbortSignal);
      signals.push(init.signal);
      return response.promise;
    };
    const owner = new LatestRequestOwner();
    let published = false;
    let finalized = false;
    const run = runOwnedRequest(
      owner,
      (requestSignal) =>
        requestJson("https://local.test/api", {
          responseLabel: "Unmounted request",
          admit: (value) => value,
          init: { signal: requestSignal },
          fetchImpl,
        }),
      {
        success: () => {
          published = true;
        },
        error: (error) => {
          throw error;
        },
        finish: () => {
          finalized = true;
        },
      },
    );

    owner.cancel();
    assertEquals(signals[0]?.aborted, true);
    response.resolve(jsonResponse({ value: "late" }));
    await run;

    assertFalse(published);
    assertFalse(finalized);
    assertFalse(owner.busy);
  });
});
