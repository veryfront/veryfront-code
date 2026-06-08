import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  appendCurrentRunToolStateToSystemPrompt,
  createCurrentRunToolState,
  createToolInputFingerprint,
  extractCurrentRunEvidence,
  hydrateCurrentRunToolStateFromMessages,
  recordCurrentRunToolResult,
  summarizeToolResultForCurrentRunState,
  validateInvokeAgentInputAgainstCurrentRunEvidence,
} from "./current-run-tool-state.ts";

describe("current-run tool state", () => {
  it("normalizes input fingerprints independent of key order", () => {
    assertEquals(
      createToolInputFingerprint({ b: 2, a: { d: 4, c: 3 } }),
      createToolInputFingerprint({ a: { c: 3, d: 4 }, b: 2 }),
    );
  });

  it("records calls by tool name and normalized input fingerprint", () => {
    const state = createCurrentRunToolState();
    const now = new Date("2026-01-01T00:00:00.000Z");

    recordCurrentRunToolResult(state, {
      toolCallId: "call_1",
      toolName: "harvest__list_accounts",
      input: {},
      result: {
        data: [
          {
            id: 123456,
            name: "Example Workspace",
            product: "harvest",
            mfa_required: false,
          },
        ],
      },
      now,
    });

    recordCurrentRunToolResult(state, {
      toolCallId: "call_2",
      toolName: "harvest__list_accounts",
      input: {},
      result: {
        data: [
          {
            id: 123456,
            name: "Example Workspace",
            product: "harvest",
            mfa_required: false,
          },
        ],
      },
      now,
    });

    assertEquals(state.harvest__list_accounts?.calls["{}"], {
      toolCallIds: ["call_1", "call_2"],
      input: {},
      status: "success",
      summary: {
        accountsCount: 1,
        accounts: [{
          id: 123456,
          name: "Example Workspace",
          product: "harvest",
        }],
        omitted: "account auth policy and provider-specific fields",
      },
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
  });

  it("uses configured summaries for known integration collection tools", () => {
    const summary = summarizeToolResultForCurrentRunState("gmail__list_emails", {
      messages: [
        {
          id: "msg-1",
          threadId: "thread-1",
          from: "Sender <sender@example.test>",
          subject: "Hello",
          snippet: "Short preview",
          body: "large body ".repeat(100),
        },
      ],
      nextPageToken: "next",
      debug: "debug ".repeat(100),
    });

    assertEquals(summary, {
      status: "success",
      summary: {
        messagesCount: 1,
        messages: [{
          id: "msg-1",
          threadId: "thread-1",
          from: "Sender <sender@example.test>",
          subject: "Hello",
          snippet: "Short preview",
        }],
        omitted: "large email bodies and provider-specific payload fields",
        nextPageToken: "next",
      },
    });
  });

  it("keeps empty collection results visible", () => {
    const summary = summarizeToolResultForCurrentRunState("github__list_prs", {
      data: [],
    });

    assertEquals(summary, {
      status: "empty",
      summary: {
        pullRequestsCount: 0,
        pullRequests: [],
        omitted: "pull request bodies, diff details, and provider-specific payload fields",
      },
    });
  });

  it("injects compact state into the system prompt", () => {
    const state = createCurrentRunToolState();
    recordCurrentRunToolResult(state, {
      toolCallId: "call_1",
      toolName: "slack__list_channels",
      input: { limit: 10 },
      result: { channels: [{ id: "C1", name: "general" }] },
      now: new Date("2026-01-01T00:00:00.000Z"),
    });

    const prompt = appendCurrentRunToolStateToSystemPrompt("Base system", state);

    assertStringIncludes(prompt, "Base system");
    assertStringIncludes(prompt, '<run_state current_run="true">');
    assertStringIncludes(prompt, '"tools"');
    assertStringIncludes(prompt, '"slack__list_channels"');
    assertStringIncludes(prompt, '"{\\"limit\\":10}"');
    assert(!prompt.includes('"input"'));
    assert(!prompt.includes('"toolCallIds"'));
    assert(!prompt.includes('"updatedAt"'));
    assert(!prompt.includes("call_1"));
  });

  it("projects orchestration tool state by semantic keys", () => {
    const state = createCurrentRunToolState();
    const now = new Date("2026-01-01T00:00:00.000Z");

    recordCurrentRunToolResult(state, {
      toolCallId: "call_1",
      toolName: "invoke_agent",
      input: {
        agent_id: "ingest-invoice-agent",
        input: "Load open invoices",
      },
      result: { status: "completed", output: "Loaded invoices" },
      now,
    });

    recordCurrentRunToolResult(state, {
      toolCallId: "call_2",
      toolName: "invoke_agent",
      input: {
        agent_id: "ingest-invoice-agent",
        input: "Load the open supplier invoice queue",
      },
      result: { status: "completed", output: "Loaded invoices again" },
      now,
    });

    recordCurrentRunToolResult(state, {
      toolCallId: "call_3",
      toolName: "load_skill",
      input: { skillId: "supplier-invoice-processing" },
      result: { skillId: "supplier-invoice-processing", instructions: "Process invoices" },
      now,
    });

    recordCurrentRunToolResult(state, {
      toolCallId: "call_5",
      toolName: "load_skill",
      input: { skillId: "supplier-invoice-processing" },
      result: { skillId: "supplier-invoice-processing", instructions: "Process invoices" },
      now,
    });

    recordCurrentRunToolResult(state, {
      toolCallId: "call_4",
      toolName: "studio_todo_write",
      input: { taskId: "supplier-invoice-processing", title: "Supplier Invoice Processing" },
      result: { status: "updated" },
      now,
    });

    const prompt = appendCurrentRunToolStateToSystemPrompt("Base system", state);

    assertStringIncludes(prompt, '<run_state current_run="true">');
    assertStringIncludes(prompt, '"semanticCalls"');
    assertStringIncludes(prompt, '"skills"');
    assertStringIncludes(prompt, '"actions"');
    assertStringIncludes(prompt, '"agent:ingest-invoice-agent"');
    assertStringIncludes(prompt, '"skill:supplier-invoice-processing"');
    assertStringIncludes(prompt, '"supplier-invoice-processing"');
    assertStringIncludes(
      prompt,
      '"supplier-invoice-processing":{"status":"success","callCount":2,"source":"tools.load_skill.semanticCalls.skill:supplier-invoice-processing"',
    );
    assertStringIncludes(prompt, '"todo:supplier-invoice-processing"');
    assertStringIncludes(prompt, '"parameters":{"agent_id":"ingest-invoice-agent"}');
    assertStringIncludes(prompt, '"callCount":2');
    assert(!prompt.includes("Load open invoices"));
    assert(!prompt.includes("Load the open supplier invoice queue"));
    assert(!prompt.includes("call_1"));
  });

  it("hydrates prior tool calls and results from persisted run messages", () => {
    const state = createCurrentRunToolState();

    hydrateCurrentRunToolStateFromMessages(state, [
      {
        role: "assistant",
        parts: [{
          type: "tool-invoke_agent",
          toolCallId: "invoke-ingest-1",
          toolName: "invoke_agent",
          args: {
            agent_id: "ingest-invoice-agent",
            input: "Load open supplier invoices",
          },
        }],
      },
      {
        role: "tool",
        parts: [{
          type: "tool-result",
          toolCallId: "invoke-ingest-1",
          toolName: "invoke_agent",
          result: {
            status: "completed",
            output: "Loaded supplier invoices",
          },
        }],
      },
    ], { now: new Date("2026-01-01T00:00:00.000Z") });

    const prompt = appendCurrentRunToolStateToSystemPrompt("Base system", state);

    assertStringIncludes(prompt, '<run_state current_run="true">');
    assertStringIncludes(prompt, '"agent:ingest-invoice-agent"');
    assertStringIncludes(prompt, '"invoke_agent:agent:ingest-invoice-agent"');
    assert(!prompt.includes("Load open supplier invoices"));
    assert(!prompt.includes("invoke-ingest-1"));
  });

  it("keeps repeated delegated agent calls distinct when a record id is provided", () => {
    const state = createCurrentRunToolState();
    const now = new Date("2026-01-01T00:00:00.000Z");

    recordCurrentRunToolResult(state, {
      toolCallId: "call_1",
      toolName: "invoke_agent",
      input: {
        agent_id: "payment-approval-agent",
        invoice_id: "INV-2026-00491",
        input: "Approve invoice INV-2026-00491",
      },
      result: { status: "completed", output: "Approved INV-2026-00491" },
      now,
    });

    recordCurrentRunToolResult(state, {
      toolCallId: "call_2",
      toolName: "invoke_agent",
      input: {
        agent_id: "payment-approval-agent",
        invoice_id: "INV-2026-00492",
        input: "Approve invoice INV-2026-00492",
      },
      result: { status: "completed", output: "Approved INV-2026-00492" },
      now,
    });

    const prompt = appendCurrentRunToolStateToSystemPrompt("Base system", state);

    assertStringIncludes(prompt, '"agent:payment-approval-agent:record:INV-2026-00491"');
    assertStringIncludes(prompt, '"agent:payment-approval-agent:record:INV-2026-00492"');
    assertStringIncludes(
      prompt,
      '"parameters":{"agent_id":"payment-approval-agent","record_id":"INV-2026-00491"}',
    );
    assertStringIncludes(
      prompt,
      '"parameters":{"agent_id":"payment-approval-agent","record_id":"INV-2026-00492"}',
    );
  });

  it("derives delegated agent semantic record keys from structured context", () => {
    const state = createCurrentRunToolState();
    const now = new Date("2026-01-01T00:00:00.000Z");

    recordCurrentRunToolResult(state, {
      toolCallId: "call_1",
      toolName: "invoke_agent",
      input: {
        agent_id: "payment-approval-agent",
        prompt: "Approve the matched invoice from structured context.",
        context: {
          matched_invoice: {
            invoice_id: "INV-2026-00491",
            supplier: "Meyer Papier GmbH",
          },
        },
      },
      result: { status: "completed", output: "Approved INV-2026-00491" },
      now,
    });

    const prompt = appendCurrentRunToolStateToSystemPrompt("Base system", state);

    assertStringIncludes(prompt, '"agent:payment-approval-agent:record:INV-2026-00491"');
    assertStringIncludes(
      prompt,
      '"parameters":{"agent_id":"payment-approval-agent","record_id":"INV-2026-00491"}',
    );
  });

  it("blocks invoke_agent inputs that contradict prior current-run tool evidence", () => {
    const state = createCurrentRunToolState();

    recordCurrentRunToolResult(state, {
      toolCallId: "invoke-ingest-1",
      toolName: "invoke_agent",
      input: { agent_id: "ingest-invoice-agent", prompt: "Load open invoices" },
      result: {
        status: "completed",
        summary: {
          text: "Ingestion complete. 2 open invoices loaded:\n\n" +
            "| Invoice | Supplier | Route |\n" +
            "| --- | --- | --- |\n" +
            "| INV-2026-00482 | Alpine Claims Services | Escalation (blocked) |\n" +
            "| INV-2026-00491 | Meyer Papier GmbH | Matching (valid) |\n",
        },
      },
    });

    const invalid = validateInvokeAgentInputAgainstCurrentRunEvidence(state, {
      agent_id: "payment-approval-agent",
      description: "Approve matched invoice INV-2026-00491 (Meridian Logistics GmbH)",
      prompt:
        "Approve invoice INV-2026-00491 for payment. This invoice from supplier Meridian Logistics GmbH for €2,180.00 matched PO-2026-1197 with zero variance.",
    });

    assertEquals(invalid.ok, false);
    if (!invalid.ok) {
      assertStringIncludes(invalid.error, 'INV-2026-00491 supplier is "Meyer Papier GmbH"');
      assertStringIncludes(invalid.error, "Meridian Logistics GmbH");
    }

    assertEquals(
      validateInvokeAgentInputAgainstCurrentRunEvidence(state, {
        agent_id: "payment-approval-agent",
        prompt:
          "Approve invoice INV-2026-00491 for payment. This invoice from supplier Meyer Papier GmbH for €2,180.00 matched PO-2026-1197 with zero variance.",
      }),
      { ok: true },
    );
  });

  it("keeps hidden evidence out of the projected current-run prompt state", () => {
    const state = createCurrentRunToolState();

    recordCurrentRunToolResult(state, {
      toolCallId: "invoke-ingest-1",
      toolName: "invoke_agent",
      input: { agent_id: "ingest-invoice-agent", prompt: "Load open invoices" },
      result: {
        status: "completed",
        summary: {
          text: "| Invoice | Supplier | Route |\n" +
            "| --- | --- | --- |\n" +
            "| INV-2026-00491 | Meyer Papier GmbH | Matching (valid) |\n",
        },
      },
    });

    const prompt = appendCurrentRunToolStateToSystemPrompt("Base system", state);

    assert(!prompt.includes('"evidence"'));
    assert(!prompt.includes("Meyer Papier GmbH"));
  });

  it("does not treat loaded skill instructions as evidence", () => {
    const state = createCurrentRunToolState();

    recordCurrentRunToolResult(state, {
      toolCallId: "load-skill-1",
      toolName: "load_skill",
      input: { skillId: "supplier-invoice-processing" },
      result: {
        skillId: "supplier-invoice-processing",
        instructions: "| Invoice | Supplier |\n" +
          "| --- | --- |\n" +
          "| INV-2026-00491 | Example Supplier GmbH |\n",
      },
    });

    assertEquals(
      validateInvokeAgentInputAgainstCurrentRunEvidence(state, {
        agent_id: "payment-approval-agent",
        prompt: "Approve invoice INV-2026-00491 from supplier Meyer Papier GmbH.",
      }),
      { ok: true },
    );
  });

  it("validates invoke_agent facts against the matching record window only", () => {
    const state = createCurrentRunToolState();

    recordCurrentRunToolResult(state, {
      toolCallId: "invoke-ingest-1",
      toolName: "invoke_agent",
      input: { agent_id: "ingest-invoice-agent", prompt: "Load open invoices" },
      result: {
        status: "completed",
        summary: {
          text: "| Invoice | Supplier | Route |\n" +
            "| --- | --- | --- |\n" +
            "| INV-2026-00482 | Alpine Claims Services | Escalation (blocked) |\n" +
            "| INV-2026-00491 | Meyer Papier GmbH | Matching (valid) |\n",
        },
      },
    });

    assertEquals(
      validateInvokeAgentInputAgainstCurrentRunEvidence(state, {
        agent_id: "invoice-work-agent",
        prompt:
          "Escalate invoice INV-2026-00482 from supplier Alpine Claims Services. Approve invoice INV-2026-00491 from supplier Meyer Papier GmbH.",
      }),
      { ok: true },
    );
  });

  it("extracts evidence from key-value child result tables", () => {
    assertEquals(
      extractCurrentRunEvidence({
        summary: {
          text: "| Field | Value |\n" +
            "| --- | --- |\n" +
            "| Invoice ID | INV-2026-00491 |\n" +
            "| Supplier | Meyer Papier GmbH |\n" +
            "| Purchase Order ID | PO-2026-1197 |\n",
        },
      }),
      [{
        recordId: "INV-2026-00491",
        fields: {
          supplier: "Meyer Papier GmbH",
          purchase_order_id: "PO-2026-1197",
        },
      }],
    );
  });

  it("retains Gmail history delta arrays declared as object fields", () => {
    const summary = summarizeToolResultForCurrentRunState("gmail__list_history", {
      history: [
        {
          id: "hist-1",
          messagesAdded: [
            {
              message: {
                id: "msg-1",
                threadId: "thread-1",
                labelIds: ["INBOX"],
                snippet: "short",
              },
            },
          ],
          messagesDeleted: [
            {
              message: {
                id: "msg-2",
                threadId: "thread-2",
              },
            },
          ],
        },
      ],
      historyId: "hist-latest",
    });

    assertEquals(summary, {
      status: "success",
      summary: {
        historyCount: 1,
        history: [{
          id: "hist-1",
          messagesAdded: [{
            message: {
              id: "msg-1",
              threadId: "thread-1",
              labelIds: ["INBOX"],
              snippet: "short",
            },
          }],
          messagesDeleted: [{
            message: {
              id: "msg-2",
              threadId: "thread-2",
            },
          }],
        }],
        omitted: "history details and provider-specific payload fields",
        historyId: "hist-latest",
      },
    });
  });
});
