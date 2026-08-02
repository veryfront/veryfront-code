import type { ModelCallContext } from "../../runtime/model-call-context.ts";
import {
  createModelCallContextRunEvents,
  type ModelCallContextRunEvent,
} from "./model-call-context-run-event-recorder.ts";

const CANONICAL_CONTEXT_ID = "11111111-1111-4111-8111-111111111111";
const FIXTURE_LIMITS = { singleEventByteLimit: 512, chunkEventByteLimit: 360 };
export const LARGE_FIXTURE_FILE = "model-call-context-run-events-large.v1.json.gz";
const encoder = new TextEncoder();

const smallContext: ModelCallContext = {
  prompt: [{ role: "system", content: "You are exact." }],
  tools: [{
    type: "function",
    name: "lookup",
    description: "Look up one item",
    inputSchema: { type: "object", properties: { id: { type: "string" } } },
  }],
};
const unicodeContext: ModelCallContext = {
  prompt: [{
    role: "user",
    content: [{ type: "text", text: "😀 漢字 café \\".repeat(24) }],
  }],
};
const productionLimitUnicodeContext: ModelCallContext = {
  prompt: [{
    role: "user",
    content: [
      { type: "text", text: '😀e\u0301漢字\\"line\n'.repeat(100_000) },
      { type: "image", mediaType: "image/png", url: "data:image/png;base64,AA==" },
      {
        type: "file",
        mediaType: "text/plain",
        url: "data:text/plain;base64,44GT44KT44Gr44Gh44Gv",
        filename: "資料.txt",
      },
    ],
  }],
};

function canonicalize(events: ModelCallContextRunEvent[]): ModelCallContextRunEvent[] {
  return events.map((event) => ({ ...event, contextId: CANONICAL_CONTEXT_ID }));
}

async function scenario(
  name: string,
  context: ModelCallContext,
  committedPrefix?: number,
  useProductionLimits = false,
) {
  const serialized = JSON.stringify(context);
  const produced = canonicalize(
    useProductionLimits
      ? await createModelCallContextRunEvents(context)
      : await createModelCallContextRunEvents(context, FIXTURE_LIMITS),
  );
  const events = committedPrefix === undefined ? produced : produced.slice(0, committedPrefix);
  return {
    name,
    serialized,
    utf8ByteLength: encoder.encode(serialized).byteLength,
    sha256: produced[0]?.sha256,
    events,
    expectedLogicalContext: committedPrefix === undefined ? context : null,
  };
}

/** Generate the frozen Code-to-API model-call context contract fixture. */
export async function buildModelCallContextContractFixture() {
  return {
    contractId: "veryfront.model-call-context.run-events",
    version: 1,
    canonicalContextId: CANONICAL_CONTEXT_ID,
    scenarios: [
      await scenario("small_exact_context", smallContext),
      await scenario("complete_multi_part_unicode_context", unicodeContext),
      await scenario("incomplete_committed_prefix", unicodeContext, 1),
    ],
  };
}

/** Generate the compressed production-limit Code-to-API contract fixture. */
export async function buildLargeModelCallContextContractFixture() {
  const generated = await scenario(
    "production_limit_multi_part_unicode_context",
    productionLimitUnicodeContext,
    undefined,
    true,
  );
  return {
    contractId: "veryfront.model-call-context.run-events.large",
    version: 1,
    canonicalContextId: CANONICAL_CONTEXT_ID,
    scenario: generated,
  };
}

async function sha256Bytes(value: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", value);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Serialize a large fixture deterministically for native gzip storage. */
export function serializeLargeModelCallContextContractFixture(
  fixture: Awaited<ReturnType<typeof buildLargeModelCallContextContractFixture>>,
): string {
  return `${JSON.stringify(fixture, null, 2)}\n`;
}

/** Build the readable integrity manifest for the decompressed artifact. */
export async function buildLargeModelCallContextContractManifest(
  decompressedText: string,
  fixture: Awaited<ReturnType<typeof buildLargeModelCallContextContractFixture>>,
) {
  const decompressedBytes = encoder.encode(decompressedText);
  return {
    contractId: fixture.contractId,
    version: fixture.version,
    artifact: LARGE_FIXTURE_FILE,
    encoding: "gzip",
    decompressedUtf8ByteLength: decompressedBytes.byteLength,
    decompressedSha256: await sha256Bytes(decompressedBytes),
    logicalContextUtf8ByteLength: fixture.scenario.utf8ByteLength,
    logicalContextSha256: fixture.scenario.sha256,
    partCount: fixture.scenario.events.length,
  };
}
