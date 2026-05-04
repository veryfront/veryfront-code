import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  buildDefaultResearchArtifactPathReminder,
  buildDefaultResearchArtifactPaths,
  shouldInjectDefaultResearchArtifactPath,
  withDefaultResearchArtifactPath,
} from "./default-research-artifact-policy.ts";

describe("default research artifact policy", () => {
  it("injects default artifact path for research tasks with save-to-project cue", () => {
    const result = withDefaultResearchArtifactPath({
      description: "Research AI trends",
      prompt: "Research the latest AI trends and save the results to the project",
      runId: "run_123",
    });

    assertStringIncludes(result, "/research/ai-trends/runs/run_123.report.md");
    assertStringIncludes(result, "/research/ai-trends/report.md");
    assertStringIncludes(result, "/research/ai-trends/findings.md");
    assertStringIncludes(result, "/research/ai-trends/sources.md");
    assertStringIncludes(result, "CRITICAL");
  });

  it("does not inject when prompt lacks save-to-project cue", () => {
    const prompt = "Research the latest AI trends and summarize findings";
    const result = withDefaultResearchArtifactPath({
      description: "Research AI trends",
      prompt,
    });

    assertEquals(result, prompt);
  });

  it("does not inject when prompt already has artifact paths", () => {
    const prompt = "Research AI trends and write the report to docs/ai-report.md";
    const result = withDefaultResearchArtifactPath({
      description: "Research AI trends",
      prompt,
    });

    assertEquals(result, prompt);
  });

  it("does not inject for non-research tasks", () => {
    const prompt = "Build a landing page and save to the project";
    const result = withDefaultResearchArtifactPath({
      description: "Build landing page",
      prompt,
    });

    assertEquals(result, prompt);
  });

  it("uses slugified topic in path", () => {
    const result = withDefaultResearchArtifactPath({
      description: "Research quantum computing",
      prompt: "Research quantum computing breakthroughs and save findings to the project",
      runId: "run-live-123",
    });

    assertStringIncludes(result, "/research/quantum-computing/runs/run-live-123.report.md");
  });

  it("returns an exact run/current workspace reminder for implicit save-to-project research", () => {
    const reminder = buildDefaultResearchArtifactPathReminder({
      description: "Research durable run staging canary behavior",
      prompt:
        "/research Research durable run staging canary behavior and save the report to the project.",
      runId: "run_123",
    });

    assertStringIncludes(
      reminder ?? "",
      "/research/durable-run-staging-canary-behavior/runs/run_123.report.md",
    );
  });

  it("returns null when an exact artifact path already exists", () => {
    assertEquals(
      buildDefaultResearchArtifactPathReminder({
        description: "Research durable run staging canary behavior",
        prompt: "/research Write exactly /plans/canary.md in this run.",
        runId: "run_123",
      }),
      null,
    );
  });

  it("does not inject a default workspace when exact artifact paths are listed", () => {
    assertEquals(
      shouldInjectDefaultResearchArtifactPath({
        description: "Research AI coding agents",
        prompt:
          "/research Research AI coding agents and save the report to the project.\n- research/ai-coding-agents/report.md\n- research/ai-coding-agents/sources.md",
      }),
      false,
    );
  });

  it("recognizes implicit save-to-project research without an exact path", () => {
    assertEquals(
      shouldInjectDefaultResearchArtifactPath({
        description: "Research durable run staging canary behavior",
        prompt:
          "/research Research durable run staging canary behavior and save the report to the project.",
      }),
      true,
    );
  });

  it("builds topic-scoped current and run report paths", () => {
    assertEquals(
      buildDefaultResearchArtifactPaths({
        description: "Research AI memory systems",
        prompt: "Research AI memory systems deeply",
        runId: "run_456",
      }),
      {
        topicSlug: "ai-memory-systems",
        topicRootPath: "/research/ai-memory-systems",
        currentReportPath: "/research/ai-memory-systems/report.md",
        runReportPath: "/research/ai-memory-systems/runs/run_456.report.md",
        findingsPath: "/research/ai-memory-systems/findings.md",
        sourcesPath: "/research/ai-memory-systems/sources.md",
      },
    );
  });

  it("falls back to a stable topic slug and run id when input is sparse", () => {
    assertEquals(
      buildDefaultResearchArtifactPaths({
        description: "",
        prompt: "Research this and save it to the project",
      }),
      {
        topicSlug: "research-report",
        topicRootPath: "/research/research-report",
        currentReportPath: "/research/research-report/report.md",
        runReportPath: "/research/research-report/runs/latest.report.md",
        findingsPath: "/research/research-report/findings.md",
        sourcesPath: "/research/research-report/sources.md",
      },
    );
  });

  it("derives a stable topic slug from root-thread research text with extra save instructions", () => {
    assertEquals(
      buildDefaultResearchArtifactPaths({
        description:
          "Research durable-run staging canary behavior and save the report to the project. Keep it short.",
        prompt:
          "/research Research durable-run staging canary behavior and save the report to the project. Keep it short.",
        runId: "run_789",
      }),
      {
        topicSlug: "durable-run-staging-canary-behavior",
        topicRootPath: "/research/durable-run-staging-canary-behavior",
        currentReportPath: "/research/durable-run-staging-canary-behavior/report.md",
        runReportPath: "/research/durable-run-staging-canary-behavior/runs/run_789.report.md",
        findingsPath: "/research/durable-run-staging-canary-behavior/findings.md",
        sourcesPath: "/research/durable-run-staging-canary-behavior/sources.md",
      },
    );
  });
});
