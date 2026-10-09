import { assert, assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { summarizeErrorCausesForLog } from "#veryfront/observability/telemetry-error.ts";
import { createRuntimeProviderStreamFailure } from "#veryfront/runtime/provider-stream-error-provenance.ts";
import { ProviderRequestError } from "veryfront/provider/shared";
import {
  appendOpenAISseChunk,
  MAX_OPENAI_SSE_BUFFER_CODE_UNITS,
  parseOpenAISseBuffer,
} from "./openai-sse-buffer.ts";

describe("ext-llm-openai/openai-sse-buffer", () => {
  it("retains safe diagnostics from actual decoding and framing failures", () => {
    const invalid = (issue: string) =>
      new ProviderRequestError({
        provider: "openai",
        status: 200,
        retryable: false,
        message: `openai request failed: invalid successful stream (${issue})`,
      });
    const cases: Array<[() => unknown, string]> = [
      [
        () =>
          appendOpenAISseChunk(
            new TextDecoder("utf-8", { fatal: true }),
            "",
            new Uint8Array([0xff]),
            invalid,
          ),
        "stream contained invalid UTF-8",
      ],
      [
        () => parseOpenAISseBuffer('data: {"private":"synthetic-secret"\n\n', invalid),
        "SSE event framing was malformed",
      ],
      [
        () =>
          appendOpenAISseChunk(
            new TextDecoder("utf-8", { fatal: true }),
            "x".repeat(MAX_OPENAI_SSE_BUFFER_CODE_UNITS),
            new Uint8Array([0]),
            invalid,
          ),
        `SSE buffer exceeded ${MAX_OPENAI_SSE_BUFFER_CODE_UNITS} code units`,
      ],
    ];
    for (const [operation, issue] of cases) {
      const error = assertThrows(operation, ProviderRequestError);
      const causes = summarizeErrorCausesForLog(createRuntimeProviderStreamFailure(error));
      assert(causes !== undefined);
      assertEquals(causes[0]?.streamIssue, issue);
      assertEquals(causes[0]?.messageRedacted, true);
      assertEquals(JSON.stringify(causes).includes("synthetic-secret"), false);
    }
  });

  it("accepts the exact raw boundary and rejects pre-concat overflow", () => {
    const invalid = (issue: string) => new Error(issue);
    const exact = appendOpenAISseChunk(
      new TextDecoder("utf-8", { fatal: true }),
      "",
      new Uint8Array(MAX_OPENAI_SSE_BUFFER_CODE_UNITS),
      invalid,
    );
    assertEquals(exact.length, MAX_OPENAI_SSE_BUFFER_CODE_UNITS);

    assertThrows(
      () =>
        appendOpenAISseChunk(
          new TextDecoder("utf-8", { fatal: true }),
          exact,
          new Uint8Array([0]),
          invalid,
        ),
      Error,
      `SSE buffer exceeded ${MAX_OPENAI_SSE_BUFFER_CODE_UNITS} code units`,
    );
  });

  it("contextualizes fatal UTF-8 decoding failures", () => {
    assertThrows(
      () =>
        appendOpenAISseChunk(
          new TextDecoder("utf-8", { fatal: true }),
          "",
          new Uint8Array([0xff]),
          (issue) => new Error(`context: ${issue}`),
        ),
      Error,
      "context: stream contained invalid UTF-8",
    );
  });

  it("parses an unterminated final record at the exact decoded boundary", () => {
    const event = 'data: {"ok":true}';
    const trailing = `${"x".repeat(MAX_OPENAI_SSE_BUFFER_CODE_UNITS - event.length - 1)}\n${event}`;
    assertEquals(trailing.length, MAX_OPENAI_SSE_BUFFER_CODE_UNITS);
    assertEquals(
      parseOpenAISseBuffer(trailing, (issue) => new Error(issue), true),
      { events: [{ ok: true }], remainder: "" },
    );
  });
});
