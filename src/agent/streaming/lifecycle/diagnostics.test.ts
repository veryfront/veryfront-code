import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { acceptDiagnosticCandidate, createDefaultDiagnosticPolicy } from "./diagnostics.ts";

describe("stream lifecycle diagnostics", () => {
  it("drops raw diagnostic candidates by default", () => {
    assertEquals(
      acceptDiagnosticCandidate(createDefaultDiagnosticPolicy(), {
        kind: "provider_payload",
        value: { authorization: "<REDACTED>" },
      }),
      null,
    );
  });

  it("publishes only the redactor result", () => {
    assertEquals(
      acceptDiagnosticCandidate({
        rawCapture: "redacted",
        redact: () => ({
          kind: "provider_shape",
          attributes: { partType: "unknown" },
        }),
      }, { kind: "provider_payload", value: { secret: "<REDACTED>" } }),
      { kind: "provider_shape", attributes: { partType: "unknown" } },
    );
  });
});
