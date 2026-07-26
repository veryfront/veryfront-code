import { VeryfrontError } from "#veryfront/errors";
import { assertEquals, assertRejects } from "#veryfront/testing/assert";
import {
  getSandboxHttpErrorStatus,
  isSandboxTransportError,
  requestSandboxJson,
  requestSandboxText,
} from "./transport.ts";

const originalFetch = globalThis.fetch;

function restoreFetch(): void {
  globalThis.fetch = originalFetch;
}

Deno.test({
  name: "sandbox transport keeps its deadline through response-body consumption",
  async fn() {
    let canceled = false;
    globalThis.fetch = (() =>
      Promise.resolve(
        new Response(
          new ReadableStream<Uint8Array>({
            cancel() {
              canceled = true;
            },
          }),
          { headers: { "Content-Type": "application/json" } },
        ),
      )) as typeof fetch;

    try {
      const error = await assertRejects(
        () =>
          requestSandboxJson({
            url: "https://api.example.test/sandbox",
            timeoutMs: 1,
            operation: "Read sandbox",
          }),
        VeryfrontError,
        "timed out after 1 ms",
      );
      assertEquals((error as VeryfrontError).slug, "timeout-error");
      await Promise.resolve();
      assertEquals(canceled, true);
    } finally {
      restoreFetch();
    }
  },
});

Deno.test("sandbox transport bounds response bodies and preserves HTTP status", async () => {
  globalThis.fetch = (() => Promise.resolve(new Response("busy", { status: 503 }))) as typeof fetch;
  try {
    const error = await assertRejects(
      () =>
        requestSandboxJson({
          url: "https://api.example.test/sandbox",
          timeoutMs: 100,
          operation: "Create sandbox",
        }),
      VeryfrontError,
      "Create sandbox: 503 busy",
    );
    assertEquals(getSandboxHttpErrorStatus(error), 503);
  } finally {
    restoreFetch();
  }

  globalThis.fetch = (() => Promise.resolve(new Response("abcdef"))) as typeof fetch;
  try {
    await assertRejects(
      () =>
        requestSandboxText({
          url: "https://api.example.test/file",
          timeoutMs: 100,
          operation: "Read file",
          maxBytes: 4,
        }),
      VeryfrontError,
      "response exceeded 4 bytes",
    );
  } finally {
    restoreFetch();
  }
});

Deno.test("sandbox transport rejects redirects and malformed successful JSON", async () => {
  let redirect: RequestRedirect | undefined;
  globalThis.fetch = ((_input: string | URL | Request, init?: RequestInit) => {
    redirect = init?.redirect;
    return Promise.resolve(new Response("{bad-json"));
  }) as typeof fetch;

  try {
    await assertRejects(
      () =>
        requestSandboxJson({
          url: "https://api.example.test/sandbox",
          timeoutMs: 100,
          operation: "Read sandbox",
        }),
      VeryfrontError,
      "response is not valid JSON",
    );
    assertEquals(redirect, "error");
  } finally {
    restoreFetch();
  }
});

Deno.test("sandbox transport classifies pre-response failures without message heuristics", async () => {
  globalThis.fetch =
    (() => Promise.reject(new TypeError("runtime-specific wording"))) as typeof fetch;

  try {
    const error = await assertRejects(
      () =>
        requestSandboxJson({
          url: "https://api.example.test/sandbox",
          timeoutMs: 100,
          operation: "Read sandbox",
        }),
      VeryfrontError,
      "transport request failed",
    );
    assertEquals(isSandboxTransportError(error), true);
    assertEquals(getSandboxHttpErrorStatus(error), undefined);
  } finally {
    restoreFetch();
  }
});

Deno.test("sandbox transport rejects invalid UTF-8 in successful bounded responses", async () => {
  globalThis.fetch = (() =>
    Promise.resolve(
      new Response(new Uint8Array([0x7b, 0x22, 0x78, 0x22, 0x3a, 0x22, 0xc3, 0x28, 0x22, 0x7d])),
    )) as typeof fetch;

  try {
    await assertRejects(
      () =>
        requestSandboxJson({
          url: "https://api.example.test/sandbox",
          timeoutMs: 100,
          operation: "Read sandbox",
        }),
      VeryfrontError,
      "response is not valid UTF-8",
    );
  } finally {
    restoreFetch();
  }
});
