import { assert, assertEquals, assertStringIncludes } from "#std/assert";
import { collectDocsCoverage, formatDocsCoverage } from "./docs-coverage.ts";

const API_DECLARATION_BASELINE = {
  total: 3024,
  withSourceLinks: 3024,
  withoutSourceLinks: 0,
} as const;

Deno.test("collectDocsCoverage reports generated reference and guide coverage", async () => {
  const report = await collectDocsCoverage(".");

  assert(report.publicExports.total > 0);
  assert(report.apiDeclarations.total >= API_DECLARATION_BASELINE.total);
  assert(
    report.apiDeclarations.withSourceLinks >=
      API_DECLARATION_BASELINE.withSourceLinks,
  );
  assert(
    report.apiDeclarations.withoutSourceLinks <=
      API_DECLARATION_BASELINE.withoutSourceLinks,
  );
  assertEquals(report.apiDeclarations.missingSourceLinkSamples, []);
  assertEquals(report.referencePages.missing, []);
  assertEquals(report.referencePages.extra, []);
  assertEquals(report.guides.withContracts, report.guides.total);
  assertEquals(
    report.guides.withCodeExampleTests,
    report.guides.withCodeExamples,
  );
});

Deno.test("formatDocsCoverage renders stable summary lines", async () => {
  const report = await collectDocsCoverage(".");
  const summary = formatDocsCoverage(report);

  assertStringIncludes(summary, "Docs coverage");
  assertStringIncludes(summary, "API declarations:");
  assertStringIncludes(summary, "Reference pages:");
  assertStringIncludes(summary, "Guide contracts:");
  assertStringIncludes(summary, "Guide code examples:");
  assertStringIncludes(summary, "Reference modules linked from guides:");
  assertStringIncludes(summary, "Guides linked from reference pages:");
});
