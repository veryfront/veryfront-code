import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  buildChildRunStatusChangedEvent,
  buildDocumentCitedEvent,
  buildFileAttachedEvent,
  buildInputRequestLifecycleEvent,
  buildNativeRunEventFrame,
  buildToolCallStatusChangedEvent,
  buildUrlCitedEvent,
  isNativeRunEventName,
  NATIVE_RUN_EVENTS,
  nativeRunEventStoredTypesByWireName,
  nativeRunEventTypes,
} from "./native-run-events.ts";

const INPUT_REQUEST = {
  id: "8f2f1f52-0f2a-4a3a-9b0f-0f2a4a3a9b0f",
  conversationId: "a7c53a3d-feb2-4404-86e2-5c562455e46c",
  runId: "run_native_events_1",
  toolCallId: "toolu_form_1",
  kind: "form",
  status: "open",
  title: "Choose a deployment target",
};

const CHILD_RUN = {
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
};

describe("agent/ag-ui-native-run-events", () => {
  it("keeps the wire, stored, and legacy tables derived from one list", () => {
    assertEquals(NATIVE_RUN_EVENTS.map((entry) => entry.wireName), [
      "ToolCallStatusChanged",
      "InputRequestCreated",
      "InputRequestUpdated",
      "ChildRunStatusChanged",
      "UrlCited",
      "DocumentCited",
      "FileAttached",
    ]);
    assertEquals(
      Object.values(nativeRunEventTypes),
      NATIVE_RUN_EVENTS.map((entry) => entry.storedType),
      "the camelCase table the run event enums spread must stay in list order",
    );
    assertEquals(
      [...nativeRunEventStoredTypesByWireName.entries()],
      NATIVE_RUN_EVENTS.map((entry) => [entry.wireName, entry.storedType]),
    );
  });

  it("accepts the six legacy custom names and rejects everything else", () => {
    for (
      const name of [
        "tool-call-status",
        "veryfront.input_request.lifecycle",
        "veryfront.invoke_agent.lifecycle",
        "source-url",
        "source-document",
        "file",
      ]
    ) {
      assertEquals(isNativeRunEventName(name), true, name);
    }
    for (const name of ["state-delta", "state-snapshot", "run-parked", "foo", "__proto__"]) {
      assertEquals(isNativeRunEventName(name), false, name);
    }
  });

  it("builds both emission shapes for a tool call status change", () => {
    // The API projector produces {...value, toolCallId, status, toolCallName}
    // for the same legacy value, so a value with no name yields a null name
    // rather than an absent field.
    assertEquals(
      buildToolCallStatusChangedEvent({ toolCallId: "tool-1", status: "pending_input" }),
      {
        live: {
          event: "ToolCallStatusChanged",
          payload: { toolCallId: "tool-1", status: "pending_input", toolCallName: null },
        },
        durable: {
          toolCallId: "tool-1",
          status: "pending_input",
          toolCallName: null,
          type: "TOOL_CALL_STATUS_CHANGED",
        },
      },
    );
    assertEquals(
      buildToolCallStatusChangedEvent({
        toolCallId: "tool-1",
        status: "streaming_input",
        toolCallName: "create_file",
        parentMessageId: "assistant-1",
      }).live.payload,
      {
        toolCallId: "tool-1",
        status: "streaming_input",
        toolCallName: "create_file",
        parentMessageId: "assistant-1",
      },
    );
  });

  it("selects the input request type from the action and drops the action field", () => {
    assertEquals(
      buildInputRequestLifecycleEvent({ action: "created", inputRequest: INPUT_REQUEST }),
      {
        live: { event: "InputRequestCreated", payload: { inputRequest: INPUT_REQUEST } },
        durable: { inputRequest: INPUT_REQUEST, type: "INPUT_REQUEST_CREATED" },
      },
    );
    assertEquals(
      buildInputRequestLifecycleEvent({ action: "updated", inputRequest: INPUT_REQUEST }),
      {
        live: { event: "InputRequestUpdated", payload: { inputRequest: INPUT_REQUEST } },
        durable: { inputRequest: INPUT_REQUEST, type: "INPUT_REQUEST_UPDATED" },
      },
    );
  });

  it("carries the child run lifecycle value through unchanged", () => {
    assertEquals(buildChildRunStatusChangedEvent(CHILD_RUN), {
      live: { event: "ChildRunStatusChanged", payload: CHILD_RUN },
      durable: { ...CHILD_RUN, type: "CHILD_RUN_STATUS_CHANGED" },
    });
  });

  it("drops the chunk type and fills the projector's derived fields on citations", () => {
    assertEquals(
      buildUrlCitedEvent({
        type: "source-url",
        sourceId: "web-1",
        url: "https://example.com/reference",
        title: "Reference",
      }),
      {
        live: {
          event: "UrlCited",
          payload: {
            sourceId: "web-1",
            url: "https://example.com/reference",
            title: "Reference",
          },
        },
        durable: {
          sourceId: "web-1",
          url: "https://example.com/reference",
          title: "Reference",
          type: "URL_CITED",
        },
      },
    );
    // The projector falls back to the url when a source id is missing.
    assertEquals(
      buildUrlCitedEvent({ type: "source-url", url: "https://example.com/a" }).live.payload,
      { url: "https://example.com/a", sourceId: "https://example.com/a" },
    );
    assertEquals(
      buildDocumentCitedEvent({
        type: "source-document",
        sourceId: "knowledge/report.md",
        mediaType: "text/markdown",
        title: "Report",
        filename: "knowledge/report.md",
      }).durable,
      {
        sourceId: "knowledge/report.md",
        mediaType: "text/markdown",
        title: "Report",
        filename: "knowledge/report.md",
        type: "DOCUMENT_CITED",
      },
    );
    assertEquals(
      buildDocumentCitedEvent({ type: "source-document", mediaType: "text/markdown" }).live.payload,
      // The projector also falls back to the source id for a missing title,
      // the way it already does for a missing source id itself.
      { mediaType: "text/markdown", sourceId: "text/markdown", title: "text/markdown" },
    );
    assertEquals(
      buildFileAttachedEvent({
        type: "file",
        url: "https://cdn.example.com/report.pdf",
        mediaType: "application/pdf",
        filename: "report.pdf",
      }).durable,
      {
        url: "https://cdn.example.com/report.pdf",
        mediaType: "application/pdf",
        filename: "report.pdf",
        type: "FILE_ATTACHED",
      },
    );
  });

  it("drops empty-string optionals from the durable record only, keeping the live wire frame lenient", () => {
    // The API declares title/filename/url as z.string().min(1).optional(), so
    // an empty string is a hard rejection on the batch append route -- the
    // durable record must drop it. The live wire frame must NOT: the chat
    // decoder's UrlCited and FileAttached cases use a string url (for
    // FileAttached) -- empty string included -- as their gate for rendering
    // the citation/attachment at all (src/chat/ag-ui.ts), so dropping the
    // key there would make it disappear rather than merely lose its title,
    // exactly the legacy `Custom` wrapper never did. DocumentCited's title
    // has the same gate but no drop-and-restore split, since it is never
    // empty in either shape -- see the dedicated title-fallback test below.
    // Required fields (url+sourceId, mediaType+sourceId, mediaType) are
    // unaffected by this: they already go through readString with a
    // non-empty fallback, in both shapes.
    assertEquals(
      buildUrlCitedEvent({
        type: "source-url",
        sourceId: "web-1",
        url: "https://a",
        title: "",
      }),
      {
        live: {
          event: "UrlCited",
          payload: { sourceId: "web-1", url: "https://a", title: "" },
        },
        durable: { sourceId: "web-1", url: "https://a", type: "URL_CITED" },
      },
      "an empty title must reach the live frame unchanged but be dropped from the durable record",
    );
    assertEquals(
      buildUrlCitedEvent({
        type: "source-url",
        sourceId: "web-1",
        url: "https://a",
        title: "Reference",
      }).live.payload,
      { sourceId: "web-1", url: "https://a", title: "Reference" },
      "a non-empty title must still be carried through",
    );

    assertEquals(
      buildDocumentCitedEvent({
        type: "source-document",
        sourceId: "d1",
        mediaType: "text/markdown",
        title: "Report",
        filename: "",
      }),
      {
        live: {
          event: "DocumentCited",
          payload: { sourceId: "d1", mediaType: "text/markdown", title: "Report", filename: "" },
        },
        durable: {
          sourceId: "d1",
          mediaType: "text/markdown",
          title: "Report",
          type: "DOCUMENT_CITED",
        },
      },
      "an empty filename must reach the live frame unchanged but be dropped from the durable record",
    );
    assertEquals(
      buildDocumentCitedEvent({
        type: "source-document",
        sourceId: "d1",
        mediaType: "text/markdown",
        title: "Report",
        filename: "report.md",
      }).live.payload,
      { sourceId: "d1", mediaType: "text/markdown", title: "Report", filename: "report.md" },
      "a non-empty title and filename must still be carried through",
    );

    assertEquals(
      buildFileAttachedEvent({
        type: "file",
        mediaType: "application/pdf",
        url: "",
        filename: "",
      }),
      {
        live: {
          event: "FileAttached",
          payload: { mediaType: "application/pdf", url: "", filename: "" },
        },
        durable: { mediaType: "application/pdf", type: "FILE_ATTACHED" },
      },
      "an empty url and filename must reach the live frame unchanged but be dropped from the durable record",
    );
    assertEquals(
      buildFileAttachedEvent({
        type: "file",
        mediaType: "application/pdf",
        url: "https://cdn.example.com/a.pdf",
        filename: "a.pdf",
      }).live.payload,
      {
        mediaType: "application/pdf",
        url: "https://cdn.example.com/a.pdf",
        filename: "a.pdf",
      },
      "a non-empty url and filename must still be carried through",
    );
  });

  it("falls back an empty or missing DOCUMENT_CITED title to the source id, in both shapes", () => {
    // Unlike its own filename or buildUrlCitedEvent's title, DocumentCited's
    // title is required at the chat UI type level
    // (ChatSourceDocumentUiPart.title is not optional), so the chat decoder
    // uses a string title as its gate for rendering the citation at all.
    // Dropping an empty one from the durable record the way the other
    // optionals are dropped would make a replayed citation unrenderable, so
    // this builder never lets title be empty in either shape -- it falls
    // back to the source id instead, the same value it already falls back
    // to when the chunk has no source id of its own.
    assertEquals(
      buildDocumentCitedEvent({
        type: "source-document",
        sourceId: "doc-1",
        mediaType: "text/markdown",
        title: "",
      }),
      {
        live: {
          event: "DocumentCited",
          payload: { sourceId: "doc-1", mediaType: "text/markdown", title: "doc-1" },
        },
        durable: {
          sourceId: "doc-1",
          mediaType: "text/markdown",
          title: "doc-1",
          type: "DOCUMENT_CITED",
        },
      },
      "an empty title must fall back to the source id in both shapes",
    );
    assertEquals(
      buildDocumentCitedEvent({
        type: "source-document",
        mediaType: "text/markdown",
      }).durable.title,
      "text/markdown",
      "a missing title falls back to the derived source id (here, the media type) the same way",
    );
  });

  it("routes every legacy name through the dispatcher", () => {
    assertEquals(
      buildNativeRunEventFrame({
        name: "tool-call-status",
        value: { toolCallId: "tool-1", status: "pending_input" },
        parentMessageId: "assistant-1",
      })?.live,
      {
        event: "ToolCallStatusChanged",
        payload: {
          toolCallId: "tool-1",
          status: "pending_input",
          toolCallName: null,
          parentMessageId: "assistant-1",
        },
      },
    );
    assertEquals(
      buildNativeRunEventFrame({
        name: "veryfront.input_request.lifecycle",
        value: { action: "updated", inputRequest: INPUT_REQUEST },
      })?.durable,
      { inputRequest: INPUT_REQUEST, type: "INPUT_REQUEST_UPDATED" },
    );
    assertEquals(
      buildNativeRunEventFrame({
        name: "veryfront.invoke_agent.lifecycle",
        value: CHILD_RUN,
      })?.durable,
      { ...CHILD_RUN, type: "CHILD_RUN_STATUS_CHANGED" },
    );
    assertEquals(
      buildNativeRunEventFrame({
        name: "file",
        value: { type: "file", url: "https://cdn.example.com/a.pdf", mediaType: "application/pdf" },
      })?.live.event,
      "FileAttached",
    );
  });

  it("returns null for a name or value that has no native frame", () => {
    // A null return is how the caller keeps the Custom wrapper, which is what
    // state deltas, state snapshots, and unknown names must still get.
    assertEquals(buildNativeRunEventFrame({ name: "state-delta", value: { ops: [] } }), null);
    assertEquals(buildNativeRunEventFrame({ name: "foo", value: { a: 1 } }), null);
    assertEquals(buildNativeRunEventFrame({ name: "tool-call-status", value: null }), null);
    assertEquals(
      buildNativeRunEventFrame({ name: "tool-call-status", value: { toolCallId: "tool-1" } }),
      null,
      "a status-less telemetry value cannot become a typed payload",
    );
    assertEquals(
      buildNativeRunEventFrame({
        name: "veryfront.input_request.lifecycle",
        value: { action: "deleted", inputRequest: INPUT_REQUEST },
      }),
      null,
    );
    assertEquals(
      buildNativeRunEventFrame({ name: "source-url", value: { type: "source-url" } }),
      null,
      "a citation with no url has no URL_CITED payload",
    );
    assertEquals(
      buildNativeRunEventFrame({
        name: "file",
        value: { type: "file-change", mediaType: "text/plain", id: "f1", status: "modified" },
      }),
      null,
      "a file-change value is FILES_CHANGED on the legacy path, never FileAttached",
    );
  });
});
