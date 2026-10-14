import { assertEquals } from "#veryfront/testing/assert.ts";
import { it } from "#veryfront/testing/bdd.ts";
import { buildKnowledgeIngestRunResult } from "./result.ts";

it("reports OKF acceptance gaps only for bundle ingestion", () => {
  const input = {
    requestedCount: 0,
    sourceMode: "explicit_sources" as const,
    knowledgePath: "knowledge",
    ingested: [],
  };
  assertEquals(buildKnowledgeIngestRunResult(input).metadata.pending_acceptance, []);
  assertEquals(
    buildKnowledgeIngestRunResult({ ...input, okfBundle: true }).metadata.pending_acceptance.length,
    4,
  );
});
