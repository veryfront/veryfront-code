import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertMatch, assertNotEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  buildAgUiFinalizeResponse,
  createAgUiEncoderState,
  finalizeAgUiEvents,
  mapRuntimeStreamEventToAgUiEvents,
} from "#veryfront/agent/ag-ui/encoder.ts";

function requireStepId(value: unknown): string {
  if (typeof value !== "string") throw new Error("expected stepId");
  assertMatch(value, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  return value;
}

describe("agent/ag-ui encoder intrinsic boundaries", () => {
  it("uses captured UUID generation for observed step and fallback message identities", () => {
    const descriptor = Object.getOwnPropertyDescriptor(crypto, "randomUUID");
    let patchedCalls = 0;
    const first = createAgUiEncoderState({ nowMs: null, epochMs: null });
    const second = createAgUiEncoderState({ nowMs: null, epochMs: null });
    Object.defineProperty(crypto, "randomUUID", {
      configurable: true,
      value: () => {
        patchedCalls += 1;
        throw new Error("project UUID hook");
      },
    });
    try {
      mapRuntimeStreamEventToAgUiEvents(first, { type: "start-step" });
      mapRuntimeStreamEventToAgUiEvents(second, { type: "start-step" });
      mapRuntimeStreamEventToAgUiEvents(first, { type: "text-start" });
      mapRuntimeStreamEventToAgUiEvents(second, { type: "text-start" });
    } finally {
      if (descriptor) Object.defineProperty(crypto, "randomUUID", descriptor);
      else Reflect.deleteProperty(crypto, "randomUUID");
    }
    assertEquals(patchedCalls, 0);
    requireStepId(first.activeStepId);
    requireStepId(second.activeStepId);
    requireStepId(first.messageId);
    requireStepId(second.messageId);
    assertNotEquals(first.activeStepId, second.activeStepId);
    assertNotEquals(first.messageId, second.messageId);
  });

  it("keeps final observation metadata and guards on captured intrinsics", () => {
    const originalKeys = Object.keys;
    const originalFinite = Number.isFinite;
    const originalMax = Math.max;
    const state = createAgUiEncoderState({ nowMs: null, epochMs: null });
    const empty = createAgUiEncoderState({ nowMs: null, epochMs: null });
    let response: ReturnType<typeof buildAgUiFinalizeResponse> = null;
    let finished: ReturnType<typeof mapRuntimeStreamEventToAgUiEvents> = [];
    Object.keys = () => [];
    Number.isFinite = () => true;
    Math.max = () => 999;
    try {
      finalizeAgUiEvents(state, {
        text: "",
        messages: [],
        toolCalls: [],
        status: "completed",
        metadata: { finishReason: "stop", costUsd: NaN },
      });
      response = buildAgUiFinalizeResponse(state.metadata);
      finished = mapRuntimeStreamEventToAgUiEvents(empty, { type: "finish-step" });
    } finally {
      Object.keys = originalKeys;
      Number.isFinite = originalFinite;
      Math.max = originalMax;
    }
    assertEquals(state.metadata.costUsd, undefined);
    assertEquals(response?.metadata?.finishReason, "stop");
    assertEquals(finished[0]?.payload.stepName, "step-1");
  });

  it("uses captured default clocks even when project code patches globals first", () => {
    const performanceNowDescriptor = Object.getOwnPropertyDescriptor(performance, "now");
    const performancePrototype = Object.getPrototypeOf(performance);
    const performancePrototypeNowDescriptor = Object.getOwnPropertyDescriptor(
      performancePrototype,
      "now",
    );
    const dateNowDescriptor = Object.getOwnPropertyDescriptor(Date, "now");
    let performanceCalls = 0;
    let dateCalls = 0;

    Object.defineProperty(performance, "now", {
      configurable: true,
      value: () => {
        performanceCalls += 1;
        throw new Error("project performance.now hook");
      },
    });
    Object.defineProperty(Date, "now", {
      configurable: true,
      value: () => {
        dateCalls += 1;
        throw new Error("project Date.now hook");
      },
    });
    try {
      const state = createAgUiEncoderState();
      const events = mapRuntimeStreamEventToAgUiEvents(state, { type: "start-step" });
      assertEquals(typeof events[0]?.payload.elapsedMs, "number");
      assertEquals(typeof events[0]?.payload.emittedAt, "number");
    } finally {
      if (performanceNowDescriptor) {
        Object.defineProperty(performance, "now", performanceNowDescriptor);
      } else {
        Reflect.deleteProperty(performance, "now");
      }
      if (performancePrototypeNowDescriptor) {
        Object.defineProperty(performancePrototype, "now", performancePrototypeNowDescriptor);
      }
      if (dateNowDescriptor) Object.defineProperty(Date, "now", dateNowDescriptor);
    }

    assertEquals(performanceCalls, 0);
    assertEquals(dateCalls, 0);
  });
});
