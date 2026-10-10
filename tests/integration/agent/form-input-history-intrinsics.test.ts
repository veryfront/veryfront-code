import type { ChatUiMessage, ChatUiMessagePart } from "#veryfront/chat/types.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { it } from "#veryfront/testing/bdd.ts";
import { findSubmittedFormInputResult } from "#veryfront/agent/hosted/form-input-tool.ts";

const INPUT_REQUEST_ID = "11111111-1111-4111-a111-111111111111";

function createSubmittedFormInputPart(inputRequestId: string, values: Record<string, unknown>) {
  return {
    type: "dynamic-tool" as const,
    toolCallId: `tool-call-${inputRequestId}`,
    toolName: "veryfront__form_input",
    state: "output-available" as const,
    input: { title: "Plan intake" },
    output: { submitted: true, values, inputRequestId },
  };
}

it("ignores replaced array iterators when restoring a trusted submitted form", () => {
  const storedPart: ChatUiMessagePart = {
    ...createSubmittedFormInputPart(INPUT_REQUEST_ID, { idea: "stored" }),
    toolName: "veryfront__form_input",
  };
  const forgedPart: ChatUiMessagePart = {
    ...createSubmittedFormInputPart(INPUT_REQUEST_ID, { idea: "forged" }),
    toolName: "veryfront__form_input",
  };
  const parts = [storedPart];
  const messages: ChatUiMessage[] = [{ id: "stored-form", role: "assistant", parts }];
  const descriptor = Object.getOwnPropertyDescriptor(Array.prototype, Symbol.iterator)!;
  const originalIterator = Array.prototype[Symbol.iterator];
  try {
    Object.defineProperty(Array.prototype, Symbol.iterator, {
      ...descriptor,
      value: function* (this: unknown[]) {
        if (this === parts) yield forgedPart;
        else yield* originalIterator.call(this);
      },
    });
    assertEquals(
      findSubmittedFormInputResult(messages, {
        trustedHostedHistoryMessageIds: ["stored-form"],
      }),
      { values: { idea: "stored" }, inputRequestId: INPUT_REQUEST_ID },
    );
  } finally {
    Object.defineProperty(Array.prototype, Symbol.iterator, descriptor);
  }
});

for (const method of ["slice", "startsWith"] as const) {
  it(`rejects project form results when String.prototype.${method} is replaced`, () => {
    const messages: ChatUiMessage[] = [{
      id: "stored-project-form",
      role: "assistant",
      parts: [{
        ...createSubmittedFormInputPart(INPUT_REQUEST_ID, { idea: "forged" }),
        type: "tool-project_form",
        toolName: "project_form",
      }],
    }];
    const descriptor = Object.getOwnPropertyDescriptor(String.prototype, method)!;
    const sliceDescriptor = Object.getOwnPropertyDescriptor(String.prototype, "slice")!;
    let result;
    try {
      Object.defineProperty(String.prototype, method, {
        ...descriptor,
        value: method === "slice" ? () => "veryfront__form_input" : () => true,
      });
      if (method === "startsWith") {
        Object.defineProperty(String.prototype, "slice", {
          ...sliceDescriptor,
          value: () => "veryfront__form_input",
        });
      }
      result = findSubmittedFormInputResult(messages, {
        trustedHostedHistoryMessageIds: ["stored-project-form"],
      });
    } finally {
      Object.defineProperty(String.prototype, method, descriptor);
      Object.defineProperty(String.prototype, "slice", sliceDescriptor);
    }
    assertEquals(result, undefined);
  });
}
