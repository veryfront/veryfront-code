import { createConversationRunEventQueueController } from "#veryfront/agent/conversation/durable.ts";
import {
  bindHostedToolCallAdmissionWriter,
  createHostedRunEventWriterCapability,
} from "#veryfront/agent/hosted/child-run-event-writer-token.ts";
import {
  type AdmitExecutorToolCall,
  bindToolCallAdmissionOwner,
  runWithToolCallAdmissionReceipt,
} from "#veryfront/runtime/tool-call-admission-dispatch.ts";
import { getCurrentToolCallOccurrenceIdentity } from "#veryfront/runtime/tool-call-occurrence.ts";
import type { RecoveryToolExecutionPolicy } from "#veryfront/runtime/execution-ownership-guard.ts";
import type { AgentRunToolCallAdmissionReceipt } from "#veryfront/runtime/tool-call-admission-receipt.ts";
import { coerceWireEvent } from "#veryfront/agent/ag-ui/sse-parser.ts";
import type { ConversationRunEvent } from "#veryfront/agent/conversation/run-events.ts";
import type { AgentRunEvent } from "#veryfront/runtime/model-call-context.ts";
import { createPrivateMap } from "#veryfront/security/private-map.ts";
import { createPrivateWeakStore } from "#veryfront/security/private-weak-store.ts";
import {
  chainPrivatePromise,
  createPrivateDeferred,
  resolvePrivatePromise,
} from "#veryfront/security/private-promise.ts";
import { createVeryfrontApiOriginBoundOutboundFetch } from "#veryfront/security/http/outbound-fetch.ts";
import { defineSchema } from "#veryfront/schemas/index.ts";
import type { RuntimeRunAgentInput } from "./schema.ts";

const ObjectFreeze = Object.freeze;

export const getProjectEventPersistenceSchema = defineSchema((v) =>
  v.object({
    mode: v.literal("runtime-owned-v1"),
    canonicalRunId: v.string().uuid(),
    latestEventId: v.number().int().nonnegative(),
    latestExternalEventSequence: v.number().int().nonnegative(),
  }).strict()
);

/** Created only by authenticated ingress; the execution input carries no credential. */
export function createProjectEventWriter(input: {
  apiUrl: string;
  runId: string;
  canonicalRunId: string;
  projectId: string;
  threadId: string;
  token: string;
  latestEventId: number;
  latestExternalEventSequence: number;
}) {
  const fetch = createVeryfrontApiOriginBoundOutboundFetch(input.apiUrl);
  const capability = createHostedRunEventWriterCapability({
    apiUrl: input.apiUrl,
    runId: input.runId,
    canonicalRunId: input.canonicalRunId,
    runEventAppendToken: input.token,
    fetch,
  });
  const queue = createConversationRunEventQueueController({
    apiUrl: input.apiUrl,
    authToken: input.token,
    runId: input.runId,
    canonicalRunId: input.canonicalRunId,
    conversationId: input.threadId,
    maxEventsPerBatch: 24,
    latestEventId: input.latestEventId,
    latestExternalEventSequence: input.latestExternalEventSequence,
    fetch,
  });
  const admissions = createPrivateMap<
    string,
    ReturnType<typeof createPrivateDeferred<AgentRunToolCallAdmissionReceipt>>
  >();
  let active = true, signal: AbortSignal | undefined, tail = resolvePrivatePromise();
  const assertActive = () => {
    if (!active) throw new Error("Project event writer is closed");
    signal?.throwIfAborted();
  };
  const pending = (id: string) => {
    let p = admissions.get(id);
    if (!p) {
      p = createPrivateDeferred<AgentRunToolCallAdmissionReceipt>();
      void chainPrivatePromise(p.promise, () => {}, () => {});
      admissions.set(id, p);
    }
    return p;
  };
  const admit: AdmitExecutorToolCall = async (call, callSignal) => {
    assertActive();
    callSignal.throwIfAborted();
    const r = await pending(call.occurrenceId).promise;
    assertActive();
    callSignal.throwIfAborted();
    if (
      r.occurrenceId !== call.occurrenceId || r.toolCallId !== call.toolCallId ||
      r.runId !== input.canonicalRunId || r.projectId !== input.projectId
    ) throw new Error("Foreign project tool admission");
    return r;
  };
  bindHostedToolCallAdmissionWriter(admit, {
    capability,
    expectedRunId: input.runId,
    projectId: input.projectId,
  });
  bindToolCallAdmissionOwner(admit, {
    runId: input.runId,
    canonicalRunId: input.canonicalRunId,
    projectId: input.projectId,
  });
  const append = (event: ConversationRunEvent, occurrenceId?: string) => {
    const operation = chainPrivatePromise(tail, async () => {
      assertActive();
      queue.enqueue(
        [event],
        occurrenceId ? { toolCallStarts: [{ occurrenceId, eventIndex: 0 }] } : undefined,
      );
      const result = await queue.flush({ abortSignal: signal });
      if (result.outcome !== "flushed" && result.outcome !== "idle") {
        throw new Error("Project event append failed");
      }
      if (occurrenceId) {
        const receipt = queue.takeToolCallAdmissionReceipt?.(occurrenceId);
        if (!receipt) throw new Error("Missing project tool admission");
        pending(occurrenceId).resolve(receipt);
      }
    });
    tail = chainPrivatePromise(operation, () => {}, (error) => {
      for (const p of admissions.values()) p.reject(error);
      throw error;
    });
    void chainPrivatePromise(tail, () => {}, () => {});
    return operation;
  };
  const executeTool: RecoveryToolExecutionPolicy = async (_execution, operation) => {
    const call = getCurrentToolCallOccurrenceIdentity();
    if (!call) throw new Error("Project tool lacks its private occurrence");
    if (!signal) throw new Error("Project writer lifetime is unbound");
    return await runWithToolCallAdmissionReceipt(
      await admit(call, signal),
      assertActive,
      operation,
      admit,
    );
  };
  return ObjectFreeze({
    bindSignal(value: AbortSignal) {
      if (signal) throw new Error("Project writer lifetime already bound");
      signal = value;
      value.addEventListener("abort", () => {
        for (const p of admissions.values()) p.reject(value.reason);
      }, { once: true });
    },
    executeTool,
    async persistRunEvent(event: AgentRunEvent) {
      await append(event as unknown as ConversationRunEvent);
      const id = "modelCallId" in event ? event.modelCallId : undefined;
      return typeof id === "string" ? queue.takeModelCallCaptureReceipt?.(id) : undefined;
    },
    async appendMappedEvent(
      mapped: { event: string; payload: Record<string, unknown> },
      occurrenceId?: string,
      observed = false,
    ) {
      const event = coerceWireEvent(mapped.event, mapped.payload);
      if (
        ["RUN_STARTED", "RUN_FINISHED", "RUN_ERROR", "MODEL_CALL_COMPLETED"].includes(
          String(event.type),
        )
      ) return;
      if (event.type === "TOOL_CALL_START" && !observed && !occurrenceId) {
        throw new Error("Project tool start lacks private occurrence");
      }
      await append(
        event as ConversationRunEvent,
        event.type === "TOOL_CALL_START" && !observed ? occurrenceId : undefined,
      );
    },
    close() {
      active = false;
      for (const p of admissions.values()) p.reject(new Error("Project event writer closed"));
      queue.dispose?.();
    },
  });
}
const writers = createPrivateWeakStore<
  RuntimeRunAgentInput,
  ReturnType<typeof createProjectEventWriter>
>();
export function bindProjectEventWriter(
  input: RuntimeRunAgentInput,
  writer: ReturnType<typeof createProjectEventWriter>,
) {
  if (writers.get(input)) throw new Error("Project writer already bound");
  writers.set(input, writer);
}
export function getProjectEventWriter(input: RuntimeRunAgentInput) {
  return writers.get(input);
}
