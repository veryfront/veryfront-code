import { assertEquals } from "jsr:@std/assert";
import { describe, it } from "jsr:@std/testing/bdd";
import {
  countSanitizerOptOuts,
  isScannedFile,
  isWithinBaseline,
} from "./check-sanitizer-baseline.ts";

describe("countSanitizerOptOuts", () => {
  it("counts each sanitizer opt-out flag", () => {
    const source = [
      "Deno.test({ sanitizeResources: false, sanitizeOps: false }, () => {});",
      "Deno.test({ sanitizeExit: false }, () => {});",
    ].join("\n");
    assertEquals(countSanitizerOptOuts(source), 3);
  });

  it("tolerates arbitrary whitespace around the colon", () => {
    assertEquals(countSanitizerOptOuts("sanitizeOps   :   false"), 1);
  });

  it("does not count opt-ins or unrelated text", () => {
    const source = [
      "Deno.test({ sanitizeResources: true }, () => {});",
      "const sanitizeOps = false; // not the option form",
    ].join("\n");
    assertEquals(countSanitizerOptOuts(source), 0);
  });
});

describe("isWithinBaseline", () => {
  it("allows counts at or below the baseline and rejects growth", () => {
    assertEquals(isWithinBaseline(408, 408), true);
    assertEquals(isWithinBaseline(407, 408), true);
    assertEquals(isWithinBaseline(409, 408), false);
  });
});

describe("isScannedFile", () => {
  it("matches TypeScript sources only", () => {
    assertEquals(isScannedFile("a.ts"), true);
    assertEquals(isScannedFile("a.tsx"), true);
    assertEquals(isScannedFile("a.js"), false);
    assertEquals(isScannedFile("a.json"), false);
  });
});
