import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createAgentKnowledgeTool } from "#veryfront/agent/runtime/knowledge-tools.ts";
import type { AgentConfig } from "#veryfront/agent/types.ts";
import {
  claimFrameworkKnowledgeMarker,
  claimHostedKnowledgeSourceReader,
  type HostedKnowledgeSourceScope,
  isFrameworkKnowledgeOptions,
  runWithHostedKnowledgeSource,
  type SourceReleaseKnowledgeFile,
} from "./hosted-source-scope.ts";
import { createSearchKnowledgeTool } from "./index.ts";

const RELEASE_FILES: readonly SourceReleaseKnowledgeFile[] = [
  {
    path: "knowledge/returns-policy.md",
    content: "---\ntitle: Returns policy\n---\n\nReturns within 45 days.",
  },
  {
    path: "knowledge/internal-pricing.md",
    content: "---\ntitle: Internal pricing\n---\n\nReturns margin notes.",
  },
  { path: "agents/support.md", content: "---\nname: Support\n---\n\nReturns agent." },
];

function sourceScope(knowledge: HostedKnowledgeSourceScope["knowledge"]) {
  const calls: number[] = [];
  const scope: HostedKnowledgeSourceScope = {
    releaseId: "release-1",
    knowledge,
    listKnowledgeFiles: () => {
      calls.push(calls.length);
      return Promise.resolve(RELEASE_FILES);
    },
  };
  return { scope, calls };
}

function paths(result: unknown): string[] {
  return (result as { data: Array<{ path: string }> }).data.map((item) => item.path);
}

function frameworkTool(knowledge: AgentConfig["knowledge"]) {
  const knowledgeTool = createAgentKnowledgeTool({ id: "support", knowledge } as AgentConfig);
  if (!knowledgeTool) throw new Error("knowledge tool expected");
  return knowledgeTool;
}

describe("hosted knowledge source binding", () => {
  it("serves the framework tool from the bound source release", async () => {
    const { scope, calls } = sourceScope(true);
    const result = await runWithHostedKnowledgeSource(
      scope,
      () => frameworkTool(true).execute({ query: "knowledge" }),
    );

    // agents/support.md is outside the knowledge folder and never served.
    assertEquals(paths(result).sort((left, right) => left.localeCompare(right)), [
      "knowledge/internal-pricing.md",
      "knowledge/returns-policy.md",
    ]);
    assertEquals(calls.length, 1);
  });

  it("caps a broader tool at the signed agent's selection", async () => {
    const { scope } = sourceScope(["knowledge/returns-policy.md"]);
    const result = await runWithHostedKnowledgeSource(
      scope,
      () => frameworkTool(true).execute({ query: "returns" }),
    );

    assertEquals(paths(result), ["knowledge/returns-policy.md"]);
  });

  it("keeps the tool's own narrower selection", async () => {
    const { scope } = sourceScope(true);
    const result = await runWithHostedKnowledgeSource(
      scope,
      () => frameworkTool(["knowledge/internal-pricing.md"]).execute({ query: "returns" }),
    );

    assertEquals(paths(result), ["knowledge/internal-pricing.md"]);
  });

  it("reads nothing when the signed agent selects no knowledge", async () => {
    const { scope, calls } = sourceScope(false);
    const result = await runWithHostedKnowledgeSource(
      scope,
      () => frameworkTool(true).execute({ query: "returns" }),
    );

    assertEquals(paths(result), []);
    assertEquals(calls.length, 0);
  });

  it("marks only framework-built tool options", () => {
    assertEquals(isFrameworkKnowledgeOptions({ id: "custom_search" }), false);
    assertEquals(createSearchKnowledgeTool({ id: "custom_search" }).id, "custom_search");
  });

  it("hands the source reader and the framework marker out only once", () => {
    assertThrows(() => claimHostedKnowledgeSourceReader(), Error, "already claimed");
    assertThrows(() => claimFrameworkKnowledgeMarker(), Error, "already claimed");
  });
});
