import { assertEquals } from "#std/assert";
import { describe, it } from "#std/testing/bdd";
import { findSanitizerOptOuts } from "./check-sanitizer-baseline.ts";

const count = (source: string) =>
  findSanitizerOptOuts(source, "a.test.ts").length;

describe("findSanitizerOptOuts", () => {
  it("counts each sanitizer opt-out flag with its line", () => {
    const source = [
      "Deno.test({ sanitizeResources: false, sanitizeOps: false }, () => {});",
      "Deno.test({ sanitizeExit: false }, () => {});",
    ].join("\n");
    const findings = findSanitizerOptOuts(source, "a.test.ts");
    assertEquals(findings.map((f) => f.line), [1, 1, 2]);
    // The literal would be counted by the ratchet itself (scripts/ is scanned).
    assertEquals(findings[2]?.message.startsWith("sanitizeExit"), true);
  });

  it("tolerates arbitrary whitespace around the colon", () => {
    assertEquals(count("sanitizeOps   :   false"), 1);
  });

  it("does not count opt-ins or unrelated text", () => {
    const source = [
      "Deno.test({ sanitizeResources: true }, () => {});",
      "const sanitizeOps = false; // not the option form",
    ].join("\n");
    assertEquals(count(source), 0);
  });
});
