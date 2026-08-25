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
      "the default policy must never publish a raw diagnostic candidate",
    );
  });

  it("ignores the redactor when raw capture is disabled", () => {
    assertEquals(
      acceptDiagnosticCandidate({
        rawCapture: "disabled",
        redact: () => ({
          kind: "provider_shape",
          attributes: { partType: "x" },
        }),
      }, { kind: "provider_payload", value: { authorization: "<REDACTED>" } }),
      null,
      "disabled raw capture must return null even when the redactor produces a safe event",
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
      "a redacted policy must publish exactly what the redactor returns",
    );
  });
});
