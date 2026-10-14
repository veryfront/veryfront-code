import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { AgentRunEventSink, ModelCallMessage } from "./model-call-context.ts";
import type { ConversationRunChunkMirror } from "#veryfront/agent/conversation/run-chunk-mirror.ts";
import { sendSSE } from "#veryfront/agent/runtime/sse-utils.ts";
import { runWithMandatoryRunEventSink } from "./run-event-sink-context.ts";
import { withRuntimeStreamOwnership } from "./runtime-stream-ownership.ts";
import {
  acknowledgeMirroredToolResult,
  aliasToolResultMirrorBarrier,
  bindToolResultMirrorBarrier,
  disposeToolResultMirrorBarrier,
  enableToolResultMirrorBarrier,
  observeToolResultMirrorStream,
  registerQueuedToolResult,
  waitForQueuedToolResults,
} from "./tool-result-mirror-barrier.ts";

function context(id: string): ModelCallMessage[] {
  return [{
    role: "tool",
    content: [{
      type: "tool-result",
      toolCallId: id,
      toolName: "reader",
      output: { type: "json", value: {} },
    }],
  }];
}

function fixture(enabled = true) {
  const mirror = {} as ConversationRunChunkMirror;
  const sink: AgentRunEventSink = () => {};
  if (enabled) enableToolResultMirrorBarrier(mirror);
  bindToolResultMirrorBarrier(sink, mirror);
  let controller!: ReadableStreamDefaultController;
  new ReadableStream({
    start(value) {
      controller = value;
    },
  });
  observeToolResultMirrorStream(sink, controller, "message-start");
  return { mirror, sink, controller };
}

describe("runtime/tool-result-mirror-barrier", () => {
  it("shares pending results and disposal with a lifecycle wrapper", async () => {
    const owner = fixture();
    const wrapper = {} as ConversationRunChunkMirror;
    aliasToolResultMirrorBarrier(owner.mirror, wrapper);
    bindToolResultMirrorBarrier(owner.sink, wrapper);
    registerQueuedToolResult(owner.sink, owner.controller, "fresh");
    const wait = waitForQueuedToolResults(
      wrapper,
      context("fresh"),
      new AbortController().signal,
    );
    disposeToolResultMirrorBarrier(owner.mirror);
    await assertRejects(() => wait, Error, "mirror disposed");
    await assertRejects(
      () => waitForQueuedToolResults(wrapper, context("fresh"), new AbortController().signal),
      Error,
      "mirror disposed",
    );
  });

  it("ignores historical results and sinks without hosted capture", async () => {
    const enabled = fixture();
    const disabled = fixture(false);
    registerQueuedToolResult(disabled.sink, disabled.controller, "historical");
    await waitForQueuedToolResults(
      enabled.mirror,
      context("historical"),
      new AbortController().signal,
    );
    await waitForQueuedToolResults(
      disabled.mirror,
      context("historical"),
      new AbortController().signal,
    );
  });

  it("requires acknowledgement by the owning mirror", async () => {
    const owner = fixture();
    const other = fixture();
    registerQueuedToolResult(owner.sink, owner.controller, "fresh");
    let complete = false;
    const wait = waitForQueuedToolResults(
      owner.mirror,
      context("fresh"),
      new AbortController().signal,
    )
      .then(() => {
        complete = true;
      });
    acknowledgeMirroredToolResult(other.mirror, "fresh");
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    assertEquals(complete, false);
    acknowledgeMirroredToolResult(owner.mirror, "fresh");
    await wait;
    assertEquals(complete, true);
  });

  it("rejects promptly when capture is aborted", async () => {
    const { mirror, sink, controller } = fixture();
    registerQueuedToolResult(sink, controller, "fresh");
    const abort = new AbortController();
    const wait = waitForQueuedToolResults(mirror, context("fresh"), abort.signal);
    abort.abort(new Error("capture cancelled"));
    await assertRejects(() => wait, Error, "capture cancelled");
    disposeToolResultMirrorBarrier(mirror);
  });

  it("rejects waiting capture when the mirror is disposed", async () => {
    const { mirror, sink, controller } = fixture();
    registerQueuedToolResult(sink, controller, "fresh");
    const wait = waitForQueuedToolResults(mirror, context("fresh"), new AbortController().signal);
    disposeToolResultMirrorBarrier(mirror);
    await assertRejects(() => wait, Error, "mirror disposed");
  });

  it("refuses a new capture after disposal", async () => {
    const { mirror } = fixture();
    disposeToolResultMirrorBarrier(mirror);
    await assertRejects(
      () => waitForQueuedToolResults(mirror, context("fresh"), new AbortController().signal),
      Error,
      "mirror disposed",
    );
  });

  it("does not register a nested stream inherited from the root sink", async () => {
    const { mirror, sink } = fixture();
    let nested!: ReadableStreamDefaultController;
    new ReadableStream({
      start(value) {
        nested = value;
      },
    });
    observeToolResultMirrorStream(sink, nested, "message-start");
    registerQueuedToolResult(sink, nested, "child-result");
    await waitForQueuedToolResults(
      mirror,
      context("child-result"),
      new AbortController().signal,
    );
  });

  it("does not let a setup-time child stream claim a local mirror", async () => {
    const mirror = {} as ConversationRunChunkMirror;
    const sink: AgentRunEventSink = () => {};
    enableToolResultMirrorBarrier(mirror);
    bindToolResultMirrorBarrier(sink, mirror);
    const encoder = new TextEncoder();
    await runWithMandatoryRunEventSink(sink, () =>
      withRuntimeStreamOwnership(async () => {
        await withRuntimeStreamOwnership(async () => {
          const child = new ReadableStream<Uint8Array>({
            start(controller) {
              sendSSE(controller, encoder, { type: "message-start", messageId: "child" });
              sendSSE(controller, encoder, {
                type: "tool-output-available",
                toolCallId: "child-result",
                output: {},
              });
              controller.close();
            },
          });
          await child.cancel();
        });
        await waitForQueuedToolResults(
          mirror,
          context("child-result"),
          new AbortController().signal,
        );
        const root = new ReadableStream<Uint8Array>({
          start(controller) {
            sendSSE(controller, encoder, { type: "message-start", messageId: "root" });
            sendSSE(controller, encoder, {
              type: "tool-output-available",
              toolCallId: "root-result",
              output: {},
            });
            controller.close();
          },
        });
        await root.cancel();
        acknowledgeMirroredToolResult(mirror, "root-result");
        await waitForQueuedToolResults(
          mirror,
          context("root-result"),
          new AbortController().signal,
        );
      }));
  });
});
