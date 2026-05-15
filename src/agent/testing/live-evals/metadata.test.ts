import { assertEquals } from "#veryfront/testing/assert.ts";
import { buildLiveEvalCaseMetadata, withLiveEvalMetadata } from "./metadata.ts";
import { buildLiveEvalCaseTagSummary } from "./report.ts";

Deno.test("buildLiveEvalCaseMetadata marks deterministic stable cases for CI", () => {
  const metadata = buildLiveEvalCaseMetadata({
    caseId: "starter-plan",
    surface: "read-only",
    requireProject: false,
    releaseGateCaseIds: ["starter-plan"],
  });

  assertEquals(metadata.tags.includes("gate:ci"), true);
  assertEquals(metadata.tags.includes("gate:nightly"), true);
  assertEquals(metadata.tags.includes("gate:release"), true);
  assertEquals(metadata.tags.includes("grading:deterministic-only"), true);
  assertEquals(metadata.tags.includes("area:starter-routing"), true);
  assertEquals(metadata.tags.includes("behavior:conversation-first"), true);
});

Deno.test("buildLiveEvalCaseMetadata separates optional judge cases from deterministic CI", () => {
  const metadata = buildLiveEvalCaseMetadata({
    caseId: "knowledge-api-routes",
    surface: "read-only",
    requireProject: false,
  });

  assertEquals(metadata.tags.includes("grading:deterministic-plus-optional-llm"), true);
  assertEquals(metadata.tags.includes("gate:nightly"), true);
  assertEquals(metadata.tags.includes("gate:ci"), false);
  assertEquals(metadata.tags.includes("area:knowledge"), true);
});

Deno.test("buildLiveEvalCaseMetadata marks experimental cases outside stable gates", () => {
  const metadata = buildLiveEvalCaseMetadata({
    caseId: "research-prototype",
    surface: "experimental",
    requireProject: true,
    releaseGateCaseIds: ["research-prototype"],
  });

  assertEquals(metadata.tags.includes("stability:experimental"), true);
  assertEquals(metadata.tags.includes("project:required"), true);
  assertEquals(metadata.tags.includes("gate:nightly"), false);
  assertEquals(metadata.tags.includes("gate:ci"), false);
  assertEquals(metadata.tags.includes("gate:release"), true);
});

Deno.test("buildLiveEvalCaseMetadata accepts custom judge prefixes and tag rules", () => {
  const metadata = buildLiveEvalCaseMetadata({
    caseId: "retrieval-audit",
    surface: "write",
    requireProject: true,
    optionalJudgeCasePrefixes: ["retrieval-"],
    areaTagRules: [
      { startsWith: "retrieval-", tag: "area:retrieval" },
      { includes: "audit", tag: "area:audit" },
    ],
  });

  assertEquals(metadata.tags.includes("grading:deterministic-plus-optional-llm"), true);
  assertEquals(metadata.tags.includes("area:retrieval"), true);
  assertEquals(metadata.tags.includes("area:audit"), true);
  assertEquals(metadata.tags.includes("area:knowledge"), false);
});

Deno.test("withLiveEvalMetadata attaches metadata and preserves case fields", () => {
  const taggedCases = withLiveEvalMetadata(
    [
      {
        id: "starter-plan",
        label: "Starter",
        verify: () => null,
      },
      {
        id: "workflow-build-and-deploy",
        label: "Workflow",
        requireProject: true,
        verify: () => null,
      },
    ],
    "write",
    { releaseGateCaseIds: new Set(["starter-plan", "workflow-build-and-deploy"]) },
  );

  assertEquals(taggedCases[0]?.label, "Starter");
  assertEquals(taggedCases[0]?.metadata.tags.includes("gate:release"), true);
  assertEquals(taggedCases[1]?.metadata.tags.includes("project:required"), true);
  assertEquals(buildLiveEvalCaseTagSummary(taggedCases)["gate:release"], 2);
});
