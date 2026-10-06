import "#veryfront/schemas/_test-setup.ts";
import "#veryfront/events/test-setup.ts";
import {
  type AgUiEvent,
  type AgUiEventOf,
  safeParseAgUiEvent,
} from "#veryfront/events/ag-ui/index.ts";

const textContent: AgUiEventOf<"TEXT_MESSAGE_CONTENT"> = {
  type: "TEXT_MESSAGE_CONTENT",
  messageId: "msg",
  delta: "hello",
};
const textDelta: string = textContent.delta;
void textDelta;

// @ts-expect-error TEXT_MESSAGE_CONTENT requires messageId.
const missingRequiredTextContent: AgUiEventOf<"TEXT_MESSAGE_CONTENT"> = {
  type: "TEXT_MESSAGE_CONTENT",
  delta: "hello",
};
void missingRequiredTextContent;

const interruptFinished: AgUiEventOf<"RUN_FINISHED"> = {
  type: "RUN_FINISHED",
  threadId: "thread",
  runId: "run",
  outcome: {
    type: "interrupt",
    interrupts: [{ id: "approval", reason: "approval" }],
  },
};

if (interruptFinished.outcome?.type === "interrupt") {
  const firstInterruptId: string = interruptFinished.outcome.interrupts[0].id;
  void firstInterruptId;
}

const cancelledFinished: AgUiEventOf<"RUN_FINISHED"> = {
  type: "RUN_FINISHED",
  threadId: "thread",
  runId: "run",
  outcome: { type: "cancelled" },
};
void cancelledFinished;

const invalidOutcome: AgUiEventOf<"RUN_FINISHED"> = {
  type: "RUN_FINISHED",
  threadId: "thread",
  runId: "run",
  outcome: {
    // @ts-expect-error RUN_FINISHED outcome does not support arbitrary outcome types.
    type: "paused",
  },
};
void invalidOutcome;

const emptyInterrupts: AgUiEventOf<"RUN_FINISHED"> = {
  type: "RUN_FINISHED",
  threadId: "thread",
  runId: "run",
  outcome: {
    type: "interrupt",
    // @ts-expect-error Interrupt outcomes require at least one interrupt.
    interrupts: [],
  },
};
void emptyInterrupts;

function readNarrowedEvent(event: AgUiEvent): string {
  switch (event.type) {
    case "TOOL_CALL_START":
      return event.toolCallName;
    case "REASONING_MESSAGE_CONTENT":
      return event.delta;
    case "RUN_FINISHED":
      return event.outcome?.type ?? "unknown";
    default:
      return event.type;
  }
}
void readNarrowedEvent;

const parseResult = safeParseAgUiEvent({
  type: "TOOL_CALL_START",
  toolCallId: "tool",
  toolCallName: "lookup",
});

if (parseResult.success && parseResult.data.type === "TOOL_CALL_START") {
  const toolCallName: string = parseResult.data.toolCallName;
  void toolCallName;
  // @ts-expect-error Parser output is narrowed to TOOL_CALL_START, not a loose field bag.
  const invalidMessageId = parseResult.data.messageId;
  void invalidMessageId;
}
