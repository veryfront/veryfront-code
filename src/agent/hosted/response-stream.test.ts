import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { FakeTime } from "#std/testing/time";
import { runHostedResponseStreamWithHeartbeat } from "./response-stream.ts";

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
    using time = new FakeTime();
    const writes: string[] = [];
    const beatCounts: number[] = [];
    const stopCounts: number[] = [];
    const firstBeat = Promise.withResolvers<void>();

    const run = runHostedResponseStreamWithHeartbeat({
      execution: {
        stream: {
          async *[Symbol.asyncIterator]() {},
        },
        waitForFinish: () => firstBeat.promise,
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
          firstBeat.resolve();
        },
        onStop: (state) => {
          stopCounts.push(state.heartbeatCount);
        },
      },
    });

    time.tick(1);
    await run;

    assertEquals(writes, ["heartbeat"], "exactly one heartbeat chunk before finish");
    assertEquals(beatCounts, [1], "onBeat fires once with count 1");
    assertEquals(stopCounts, [1], "onStop reports the final heartbeat count");
  });

  it("stops the heartbeat interval when the writer rejects a heartbeat chunk", async () => {
    using time = new FakeTime();
    const writes: string[] = [];
    const firstBeat = Promise.withResolvers<void>();
    let beats = 0;

    const run = runHostedResponseStreamWithHeartbeat({
      execution: {
        stream: {
          async *[Symbol.asyncIterator]() {},
        },
        waitForFinish: () => firstBeat.promise,
      },
      writer: {
        write: (chunk) => {
          if (chunk === "heartbeat") {
            throw new Error("closed");
          }
          writes.push(chunk);
        },
      },
      heartbeat: {
        intervalMs: 1,
        buildChunk: () => "heartbeat",
        onBeat: () => {
          beats++;
        },
      },
    });

    time.tick(1);
    time.tick(5);
    firstBeat.resolve();
    await run;

    assertEquals(beats, 1, "heartbeat interval must be cleared after the writer throws");
    assertEquals(writes, [], "no stream chunks are written when the stream is empty");
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
