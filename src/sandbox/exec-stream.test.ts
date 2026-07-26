import { assertEquals, assertRejects } from "#veryfront/testing/assert";
import { VeryfrontError } from "#veryfront/errors";
import { decodeSandboxExecStream } from "./exec-stream.ts";
import type { ExecStreamEvent } from "./types.ts";

async function collect(
  stream: AsyncIterable<ExecStreamEvent>,
): Promise<ExecStreamEvent[]> {
  const events: ExecStreamEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

Deno.test("decodeSandboxExecStream preserves split UTF-8 and validates events", async () => {
  const bytes = new TextEncoder().encode(
    `${JSON.stringify({ type: "stdout", data: "hello 🌍" })}\n` +
      `${JSON.stringify({ type: "exit", exitCode: 0 })}\n`,
  );
  const split = bytes.indexOf(0xf0) + 2;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes.subarray(0, split));
      controller.enqueue(bytes.subarray(split));
      controller.close();
    },
  });

  assertEquals(await collect(decodeSandboxExecStream(body)), [
    { type: "stdout", data: "hello 🌍" },
    { type: "exit", exitCode: 0 },
  ]);
});

Deno.test("decodeSandboxExecStream fails closed and cancels malformed NDJSON", async () => {
  let canceled = false;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("{not-json}\n"));
    },
    cancel() {
      canceled = true;
    },
  });

  await assertRejects(
    () => collect(decodeSandboxExecStream(body)),
    VeryfrontError,
    "contains malformed NDJSON",
  );
  assertEquals(canceled, true);
});

Deno.test("decodeSandboxExecStream rejects oversized and invalid protocol events", async () => {
  const oversized = new Response(
    `${JSON.stringify({ type: "stdout", data: "x".repeat(64) })}\n`,
  ).body!;
  await assertRejects(
    () => collect(decodeSandboxExecStream(oversized, { maxEventBytes: 32 })),
    VeryfrontError,
    "event exceeded 32 bytes",
  );

  const invalid = new Response(`${JSON.stringify({ type: "exit" })}\n`).body!;
  await assertRejects(
    () => collect(decodeSandboxExecStream(invalid)),
    VeryfrontError,
    "exit event must include",
  );
});

Deno.test("decodeSandboxExecStream rejects invalid UTF-8", async () => {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array([0xff, 0x0a]));
      controller.close();
    },
  });

  await assertRejects(
    () => collect(decodeSandboxExecStream(body)),
    VeryfrontError,
    "not valid UTF-8",
  );
});

Deno.test("decodeSandboxExecStream enforces one terminal exit event", async () => {
  await assertRejects(
    async () => {
      for await (
        const _event of decodeSandboxExecStream(
          new Response('{"type":"stdout","data":"partial"}\n').body!,
        )
      ) {
        // Consume the stream to EOF.
      }
    },
    VeryfrontError,
    "ended without an exit event",
  );

  await assertRejects(
    async () => {
      for await (
        const _event of decodeSandboxExecStream(
          new Response(
            '{"type":"exit","exitCode":0}\n{"type":"stdout","data":"late"}\n',
          ).body!,
        )
      ) {
        // Consume until the invalid post-exit event is observed.
      }
    },
    VeryfrontError,
    "after its exit event",
  );
});
