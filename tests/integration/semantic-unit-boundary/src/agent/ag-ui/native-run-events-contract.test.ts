// This test reads the pinned cross-repository contract fixture off disk to
// hash its bytes, a genuine filesystem read, so it lives in the semantic
// integration suite rather than beside the colocated unit tests.
import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  buildChildRunStatusChangedEvent,
  buildDocumentCitedEvent,
  buildFileAttachedEvent,
  buildInputRequestLifecycleEvent,
  buildToolCallStatusChangedEvent,
  buildUrlCitedEvent,
  NATIVE_RUN_EVENTS,
  type NativeRunEventFrame,
} from "../../../../../../src/agent/ag-ui/native-run-events.ts";

// Resolved from this module's URL, not the working directory, so the suite runs
// the same way from any cwd.
const FIXTURE_URL = new URL(
  "../../../../../../tests/fixtures/contracts/native-run-events.json",
  import.meta.url,
);

// The veryfront-api copy of this file pins the same digest, which is what makes
// the two repositories byte-identical rather than merely similar.
const NATIVE_RUN_EVENTS_FIXTURE_SHA256 =
  "a4e3e51168fd6d51d47b5baeb0579be892d4189c9f1231f34853b99744e41287";

const INPUT_REQUEST = {
  id: "8f2f1f52-0f2a-4a3a-9b0f-0f2a4a3a9b0f",
  conversationId: "a7c53a3d-feb2-4404-86e2-5c562455e46c",
  runId: "run_native_events_1",
  toolCallId: "toolu_form_1",
  kind: "form",
  status: "open",
  requestedResponderType: "human",
  title: "Choose a deployment target",
  description: null,
  fields: [{ type: "confirm", name: "confirmed", label: "Confirm?" }],
  recommendations: null,
  metadata: null,
  createdAt: "2026-09-09T00:00:00.000Z",
  expiresAt: "2026-09-09T00:15:00.000Z",
  submittedAt: null,
  cancelledAt: null,
  expiredAt: null,
  latestResponse: null,
};

function buildSamples(): NativeRunEventFrame[] {
  return [
    buildToolCallStatusChangedEvent({
      toolCallId: "toolu_01",
      status: "pending_input",
      toolCallName: "create_file",
      parentMessageId: "33333333-3333-4333-a333-333333333333",
    }),
    buildInputRequestLifecycleEvent({ action: "created", inputRequest: INPUT_REQUEST }),
    buildInputRequestLifecycleEvent({
      action: "updated",
      inputRequest: {
        ...INPUT_REQUEST,
        status: "submitted",
        submittedAt: "2026-09-09T00:05:00.000Z",
      },
    }),
    buildChildRunStatusChangedEvent({
      toolCallId: "toolu_child_1",
      childConversationId: "22222222-2222-4222-a222-222222222222",
      childRunId: "run_child_1",
      childMessageId: "33333333-3333-4333-a333-333333333333",
      childAgentId: "researcher",
      description: "Inspect logs",
      status: "running",
      sourceTargetKind: "project",
      runtimeTargetKind: "main_branch",
      targetEnvironmentId: null,
      targetBranchId: null,
    }),
    buildUrlCitedEvent({
      type: "source-url",
      sourceId: "web-1",
      url: "https://example.com/reference",
      title: "Reference",
    }),
    buildDocumentCitedEvent({
      type: "source-document",
      sourceId: "knowledge/report.md",
      mediaType: "text/markdown",
      title: "Report",
      filename: "knowledge/report.md",
    }),
    buildFileAttachedEvent({
      type: "file",
      url: "https://cdn.example.com/report.pdf",
      mediaType: "application/pdf",
      filename: "report.pdf",
    }),
  ];
}

describe("agent/ag-ui-native-run-events-contract", () => {
  it("pins one sample per native type in both emission shapes", () => {
    const fixture = JSON.parse(Deno.readTextFileSync(FIXTURE_URL)) as Array<{
      storedType: string;
      legacyCustomName: string;
      live: { event: string; payload: Record<string, unknown> };
      durable: Record<string, unknown>;
    }>;

    assertEquals(fixture.length, NATIVE_RUN_EVENTS.length);
    assertEquals(
      fixture.map((entry) => [entry.storedType, entry.legacyCustomName]),
      NATIVE_RUN_EVENTS.map((entry) => [entry.storedType, entry.legacyCustomName]),
    );
    assertEquals(
      buildSamples().map((frame) => ({ live: frame.live, durable: frame.durable })),
      fixture.map((entry) => ({ live: entry.live, durable: entry.durable })),
      "regenerate tests/fixtures/contracts/native-run-events.json and the veryfront-api copy",
    );
  });

  it("keeps the durable shape a restatement of the live payload", () => {
    for (const frame of buildSamples()) {
      assertEquals(frame.durable, { ...frame.live.payload, type: frame.durable.type });
    }
  });

  it("matches the digest the veryfront-api copy pins", async () => {
    const bytes = Deno.readFileSync(FIXTURE_URL);
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    assertEquals(
      [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join(""),
      NATIVE_RUN_EVENTS_FIXTURE_SHA256,
    );
  });
});
