import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { VeryfrontError } from "#veryfront/errors";
import { webhook } from "./factory.ts";
import { prepareWebhookInvocation, renderWebhookPromptTemplate } from "./runtime.ts";
import type { WebhookEventFilterCondition } from "./types.ts";

describe("webhook/runtime", () => {
  it("normalizes JSONPath root prefixes before evaluating filters", () => {
    const definition = webhook({
      id: "jsonpath-filter",
      target: { kind: "workflow", id: "process-event" },
      eventFilter: {
        mode: "all",
        conditions: [{ path: "$.repository.name", operator: "equals", value: "code" }],
      },
    });

    assertEquals(definition.eventFilter?.conditions[0]?.path, "repository.name");
    assertEquals(
      prepareWebhookInvocation(definition, { repository: { name: "code" } }).matched,
      true,
    );
  });

  it("matches every hosted filter operator with structural JSON equality", () => {
    const definition = webhook({
      id: "pull-request",
      target: { kind: "task", id: "process-pull-request" },
      eventFilter: {
        mode: "all",
        conditions: [
          { path: "action", operator: "equals", value: "opened" },
          { path: "pull_request.draft", operator: "not_equals", value: true },
          {
            path: "action",
            operator: "in",
            value: ["opened", "reopened", "synchronize"],
          },
          { path: "pull_request.number", operator: "exists" },
          {
            path: "pull_request.labels",
            operator: "contains",
            value: "backend",
          },
          {
            path: "repository.full_name",
            operator: "contains",
            value: "veryfront/",
          },
          {
            path: "metadata",
            operator: "equals",
            value: { second: 2, first: 1 },
          },
        ],
      },
    });

    const invocation = prepareWebhookInvocation(definition, {
      action: "opened",
      pull_request: {
        draft: false,
        number: 42,
        labels: ["needs-review", "backend"],
      },
      repository: { full_name: "veryfront/veryfront-code" },
      metadata: { first: 1, second: 2 },
    });

    assertEquals(invocation.matched, true);
  });

  it("rejects payloads that fail each hosted filter operator", () => {
    function matched(
      condition: WebhookEventFilterCondition,
      payload: Record<string, unknown>,
    ): boolean {
      const definition = webhook({
        id: "operator-negative",
        target: { kind: "task", id: "process-event" },
        eventFilter: { mode: "all", conditions: [condition] },
      });
      return prepareWebhookInvocation(definition, payload).matched;
    }

    assertEquals(
      matched({ path: "action", operator: "equals", value: "opened" }, { action: "closed" }),
      false,
      "equals must reject a different value",
    );
    assertEquals(
      matched(
        { path: "pull_request.draft", operator: "not_equals", value: true },
        { pull_request: { draft: true } },
      ),
      false,
      "not_equals must reject a payload holding the excluded value",
    );
    assertEquals(
      matched(
        { path: "action", operator: "in", value: ["opened", "reopened", "synchronize"] },
        { action: "closed" },
      ),
      false,
      "in must reject a value outside the declared set",
    );
    assertEquals(
      matched({ path: "pull_request.number", operator: "exists" }, { pull_request: {} }),
      false,
      "exists must reject a payload missing the demanded path",
    );
    assertEquals(
      matched(
        { path: "pull_request.labels", operator: "contains", value: "backend" },
        { pull_request: { labels: ["needs-review"] } },
      ),
      false,
      "contains must reject an array without the demanded member",
    );
    assertEquals(
      matched(
        { path: "repository.full_name", operator: "contains", value: "veryfront/" },
        { repository: { full_name: "other/veryfront-code" } },
      ),
      false,
      "contains must reject a string without the demanded substring",
    );
  });

  it("rejects a payload object that omits keys the condition demands", () => {
    const base = {
      id: "structural-equality",
      target: { kind: "task" as const, id: "process-event" },
    };
    const equals = webhook({
      ...base,
      eventFilter: {
        mode: "all",
        conditions: [{ path: "metadata", operator: "equals", value: { first: 1, second: 2 } }],
      },
    });
    const notEquals = webhook({
      ...base,
      eventFilter: {
        mode: "all",
        conditions: [{ path: "metadata", operator: "not_equals", value: { first: 1, second: 2 } }],
      },
    });

    assertEquals(
      prepareWebhookInvocation(equals, { metadata: { first: 1 } }).matched,
      false,
      "equals must not match a payload object missing a demanded key",
    );
    assertEquals(
      prepareWebhookInvocation(notEquals, { metadata: { first: 1 } }).matched,
      true,
      "not_equals must treat a payload object missing a demanded key as different",
    );
    assertEquals(
      prepareWebhookInvocation(equals, { metadata: { first: 1, second: 2, third: 3 } }).matched,
      false,
      "equals must not match a payload object carrying extra keys",
    );
  });

  it("preserves all, any, empty-filter, and missing-path semantics", () => {
    const base = {
      id: "event",
      target: { kind: "workflow" as const, id: "process-event" },
    };
    const all = webhook({
      ...base,
      eventFilter: {
        mode: "all",
        conditions: [
          { path: "action", operator: "equals", value: "opened" },
          { path: "missing", operator: "not_equals", value: "present" },
        ],
      },
    });
    const any = webhook({
      ...base,
      eventFilter: {
        mode: "any",
        conditions: [
          { path: "action", operator: "equals", value: "closed" },
          { path: "repository.name", operator: "equals", value: "code" },
        ],
      },
    });
    const empty = webhook({
      ...base,
      eventFilter: { mode: "any", conditions: [] },
    });

    assertEquals(
      prepareWebhookInvocation(all, { action: "opened" }).matched,
      true,
    );
    assertEquals(
      prepareWebhookInvocation(any, {
        action: "opened",
        repository: { name: "other" },
      }).matched,
      false,
    );
    assertEquals(prepareWebhookInvocation(empty, null).matched, true);
    const workflowInvocation = prepareWebhookInvocation(base, undefined);
    assertEquals(workflowInvocation.payload, {});
    assertEquals(workflowInvocation.targetInput, { payload: {} });
  });

  it("renders cloud-compatible payload placeholders and fallback context", () => {
    const definition = webhook({
      id: "agent-event",
      target: { kind: "agent", id: "triage-agent" },
      agentMessage: {
        promptTemplate:
          "Review {{ payload.pull_request.title }} ({{payload.action}}): {{payload.labels}} / {{payload.missing}}",
      },
    });
    const invocation = prepareWebhookInvocation(definition, {
      action: "opened",
      labels: ["backend", "urgent"],
      pull_request: { title: "Harden webhooks" },
    });

    assertEquals(
      invocation.agentInput,
      [
        "Review Harden webhooks (opened): [",
        '  "backend",',
        '  "urgent"',
        "] / ",
      ].join("\n"),
    );
    assertEquals(
      renderWebhookPromptTemplate(
        "Summarize the event.",
        invocation.payload,
      ),
      [
        "Summarize the event.",
        "",
        "Webhook payload:",
        "```json",
        "{",
        '  "action": "opened",',
        '  "labels": [',
        '    "backend",',
        '    "urgent"',
        "  ],",
        '  "pull_request": {',
        '    "title": "Harden webhooks"',
        "  }",
        "}",
        "```",
      ].join("\n"),
    );
    assertEquals(
      renderWebhookPromptTemplate(
        "{{payload.literal}}",
        { literal: "{{payload.secret}}", secret: "leaked" },
      ),
      "{{payload.secret}}",
      "rendered payload values must never be re-expanded as placeholders",
    );
  });

  it("owns payload state and rejects unsafe or oversized fixtures", () => {
    const definition = webhook({
      id: "event",
      target: { kind: "task", id: "process-event" },
    });
    const payload = { nested: { value: "captured" } };
    const invocation = prepareWebhookInvocation(definition, payload);
    payload.nested.value = "mutated";
    assertEquals(invocation.payload, { nested: { value: "captured" } });

    const boundaryPayload = { data: "x".repeat(65_525) };
    const boundaryInvocation = prepareWebhookInvocation(
      definition,
      boundaryPayload,
    );
    assertEquals(
      new TextEncoder().encode(JSON.stringify(boundaryInvocation.payload))
        .byteLength,
      64 * 1_024,
    );

    let getterCalls = 0;
    const accessorPayload = {};
    Object.defineProperty(accessorPayload, "secret", {
      enumerable: true,
      get() {
        getterCalls++;
        return "must-not-run";
      },
    });
    assertThrows(
      () => prepareWebhookInvocation(definition, accessorPayload),
      VeryfrontError,
      "Webhook payload must be JSON-serializable.",
    );
    assertEquals(getterCalls, 0);

    assertThrows(
      () =>
        prepareWebhookInvocation(definition, {
          data: "x".repeat(64 * 1_024),
        }),
      VeryfrontError,
      "Webhook payload must be 64 KiB or smaller.",
    );
  });

  it("does not render an agent prompt for a filtered event", () => {
    const definition = webhook({
      id: "agent-event",
      target: { kind: "agent", id: "triage-agent" },
      eventFilter: {
        mode: "all",
        conditions: [
          { path: "action", operator: "equals", value: "opened" },
        ],
      },
      agentMessage: { promptTemplate: "Review {{payload.action}}." },
    });

    assertEquals(
      prepareWebhookInvocation(definition, { action: "closed" }),
      {
        definition,
        payload: { action: "closed" },
        targetInput: { action: "closed" },
        matched: false,
      },
    );
  });
});
