/**
 * Base64 independence coverage for binary integration endpoint responses.
 *
 * Lives under tests/integration because it replaces the process-wide `btoa`
 * and `Buffer` globals to prove a patched runtime cannot alter the encoded
 * MIME bytes. The hermetic padding assertions stay colocated in
 * src/integrations/outlook-message-mime.test.ts.
 */

import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { executeLocalIntegrationEndpoint } from "#veryfront/integrations/local-endpoint-executor.ts";

const paddingCases: ReadonlyArray<readonly [readonly number[], string]> = [
  [[0xff], "/w=="],
  [[0xff, 0x00], "/wA="],
  [[0xfb, 0xff, 0xbf], "+/+/"],
  [[1, 2, 3, 4], "AQIDBA=="],
  [[1, 2, 3, 4, 5], "AQIDBAU="],
];

function executeBinary(bytes: Uint8Array<ArrayBuffer>): Promise<unknown> {
  return executeLocalIntegrationEndpoint({
    connectorName: "example",
    toolId: "example__binary",
    endpoint: {
      method: "GET",
      url: "https://binary.example.test/message",
      response: { encoding: "base64" },
    },
    args: {},
    authHeaders: {},
    allowedOrigin: "https://binary.example.test",
    transport: () => Promise.resolve(new Response(bytes)),
  });
}

describe("binary endpoint base64 encoding", () => {
  it("encodes byte-exact base64 even when btoa and Buffer are replaced", async () => {
    const globals = globalThis as { btoa: unknown; Buffer?: unknown };
    const originalBtoa = globals.btoa;
    const hadBuffer = Object.hasOwn(globals, "Buffer");
    const originalBuffer = globals.Buffer;
    const poisoned = () => "POISONED";
    globals.btoa = poisoned;
    globals.Buffer = { from: () => ({ toString: poisoned }) };
    try {
      for (const [body, expected] of paddingCases) {
        const result = await executeBinary(new Uint8Array(body)) as Record<string, unknown>;
        assertEquals(result.content_base64, expected, String(body));
      }
    } finally {
      globals.btoa = originalBtoa;
      if (hadBuffer) globals.Buffer = originalBuffer;
      else delete globals.Buffer;
    }
  });
});
