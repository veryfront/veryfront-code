import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { runHostedResponseStreamWithHeartbeat } from "./hosted-response-stream.ts";

describe("agent/hosted-response-stream", () => {
  it("writes streamed chunks through the hosted lifecycle wrapper", async () => {
    const writes: string[] = [];
    const calls: string[] = [];

    await runHostedResponseStreamWithHeartbeat({
      execution: {
        stream: {
          async *[Symbol.asyncIterator]() {
            yield "chunk-1";
            yield "chunk-2";
          },
        },
        waitForFinish: async () => {
          calls.push("waitForFinish");
        },
      },
      writer: {
        write: (chunk) => {
          writes.push(chunk);
        },
      },
    });

    assertEquals(writes, ["chunk-1", "chunk-2"]);
    assertEquals(calls, ["waitForFinish"]);
  });

  it("emits heartbeat chunks and stop callbacks while the hosted lifecycle waits", async () => {
    const writes: string[] = [];
    const beatCounts: number[] = [];
    const stopCounts: number[] = [];

    await runHostedResponseStreamWithHeartbeat({
      execution: {
        stream: {
          async *[Symbol.asyncIterator]() {},
        },
        waitForFinish: async () => {
          await new Promise((resolve) => setTimeout(resolve, 10));
        },
      },
      writer: {
        write: (chunk) => {
          writes.push(chunk);
        },
      },
      heartbeat: {
        intervalMs: 1,
        buildChunk: () => "heartbeat",
        onBeat: (state) => {
          beatCounts.push(state.heartbeatCount);
        },
        onStop: (state) => {
          stopCounts.push(state.heartbeatCount);
        },
      },
    });

    assertEquals(writes.includes("heartbeat"), true);
    assertEquals(beatCounts.length > 0, true);
    assertEquals(stopCounts.length, 1);
    assertEquals(stopCounts[0] >= 1, true);
  });

  it("rethrows writer errors from streamed chunks", async () => {
    await assertRejects(
      () =>
        runHostedResponseStreamWithHeartbeat({
          execution: {
            stream: {
              async *[Symbol.asyncIterator]() {
                yield "chunk";
              },
            },
            waitForFinish: async () => {},
          },
          writer: {
            write: () => {
              throw new Error("write failed");
            },
          },
        }),
      Error,
      "write failed",
    );
  });
});
