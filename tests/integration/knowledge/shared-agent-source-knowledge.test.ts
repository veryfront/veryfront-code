import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { withMockFetch } from "#veryfront/testing/mock-fetch.ts";
import { runWithRuntimeRequestContext } from "#veryfront/platform/runtime-request-context.ts";
import { createAgentKnowledgeTool } from "#veryfront/agent/runtime/knowledge-tools.ts";
import type { AgentConfig } from "#veryfront/agent/types.ts";
import type { ToolExecutionContext } from "#veryfront/tool/types.ts";
import { createSearchKnowledgeTool } from "#veryfront/knowledge/index.ts";
import { runWithHostedKnowledgeSource } from "#veryfront/knowledge/hosted-source-scope.ts";

const SOURCE_RELEASE_FILES = "/projects/support-source/releases/release-1/files";
const HOME_ENVIRONMENT_FILES = "/projects/account-home/environments/Production/files";

type Request = { path: string; authorization: string | null };

const hosts: string[] = [];

function knowledgeFile(path: string, title: string, body: string) {
  return {
    id: `file-${path}`,
    version_id: `version-${path}`,
    path,
    content: ["---", `title: ${title}`, "---", "", body].join("\n"),
    type: "file",
    size: 64,
    updated_at: "2026-11-01T00:00:00.000Z",
  };
}

function listing(data: unknown[]) {
  return new Response(
    JSON.stringify({
      data,
      page_info: { self: null, first: null, next: null, prev: null },
      release_id: "release-1",
      release_version: "1",
      environment_id: "environment-1",
      environment_name: "Production",
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

/** Source release holds the agent's knowledge; the account home holds none. */
async function search(
  execute: () => Promise<{ data: Array<{ path: string }> }>,
): Promise<{ paths: string[]; requests: Request[] }> {
  const requests: Request[] = [];
  const result = await withMockFetch((input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    hosts.push(url.host);
    requests.push({
      path: url.pathname,
      authorization: new Headers(init?.headers).get("Authorization"),
    });
    if (url.pathname === SOURCE_RELEASE_FILES) {
      return Promise.resolve(listing([
        knowledgeFile("knowledge/returns-policy.md", "Returns policy", "Returns within 45 days."),
        knowledgeFile("knowledge/internal-pricing.md", "Internal pricing", "Returns margin notes."),
      ]));
    }
    if (url.pathname === HOME_ENVIRONMENT_FILES) return Promise.resolve(listing([]));
    return Promise.resolve(new Response("unexpected", { status: 404 }));
  }, execute);
  return { paths: result.data.map((item) => item.path), requests };
}

/** The consuming project's runtime identity, as the agent-stream handler binds it. */
function inAccountHome<T>(fn: () => T): T {
  return runWithRuntimeRequestContext({
    projectId: "00000000-0000-4000-8000-0000000000e1",
    projectSlug: "account-home",
    token: "home-run-token",
    productionMode: true,
    environmentName: "Production",
  }, fn);
}

const toolContext = {
  authToken: "home-run-token",
  projectId: "00000000-0000-4000-8000-0000000000e1",
} as ToolExecutionContext;

const sourceScope = {
  projectId: "00000000-0000-4000-8000-0000000000a1",
  projectSlug: "support-source",
  releaseId: "release-1",
  authToken: "source-read-token",
};

function frameworkTool(knowledge: AgentConfig["knowledge"]) {
  const knowledgeTool = createAgentKnowledgeTool({ id: "support", knowledge } as AgentConfig);
  if (!knowledgeTool) throw new Error("knowledge tool expected");
  return knowledgeTool;
}

describe("shared agent knowledge source", () => {
  it("reads the consuming project without a source binding", async () => {
    const knowledgeTool = frameworkTool(true);
    const { paths, requests } = await search(() =>
      inAccountHome(() => knowledgeTool.execute({ query: "returns" }, toolContext))
    );

    assertEquals(paths, []);
    assertEquals(requests, [{
      path: HOME_ENVIRONMENT_FILES,
      authorization: "Bearer home-run-token",
    }]);
  });

  it("reads the pinned source release with the source credential", async () => {
    const knowledgeTool = frameworkTool(true);
    const { paths, requests } = await search(() =>
      runWithHostedKnowledgeSource(
        sourceScope,
        () => inAccountHome(() => knowledgeTool.execute({ query: "returns" }, toolContext)),
      )
    );

    assertEquals(paths.includes("knowledge/returns-policy.md"), true);
    assertEquals(requests, [{
      path: SOURCE_RELEASE_FILES,
      authorization: "Bearer source-read-token",
    }]);
  });

  it("keeps the agent's knowledge selection on the source release", async () => {
    const knowledgeTool = frameworkTool(["knowledge/returns-policy.md"]);
    const { paths } = await search(() =>
      runWithHostedKnowledgeSource(
        sourceScope,
        () => inAccountHome(() => knowledgeTool.execute({ query: "returns" }, toolContext)),
      )
    );

    assertEquals(paths, ["knowledge/returns-policy.md"]);
  });

  it("sends the source credential only to the host-owned API", async () => {
    const knowledgeTool = frameworkTool(true);
    hosts.length = 0;
    const { requests } = await search(() =>
      runWithHostedKnowledgeSource(
        sourceScope,
        () =>
          inAccountHome(() =>
            knowledgeTool.execute(
              { query: "returns" },
              { ...toolContext, apiUrl: "https://elsewhere.test" } as ToolExecutionContext,
            )
          ),
      )
    );

    assertEquals(requests.map((request) => request.authorization), ["Bearer source-read-token"]);
    assertEquals(hosts.includes("elsewhere.test"), false);
  });

  it("never gives the source credential to a project-authored knowledge tool", async () => {
    const authoredTool = createSearchKnowledgeTool({ id: "custom_search" });
    const { requests } = await search(() =>
      runWithHostedKnowledgeSource(
        sourceScope,
        () => inAccountHome(() => authoredTool.execute({ query: "returns" }, toolContext)),
      )
    );

    assertEquals(requests, [{
      path: HOME_ENVIRONMENT_FILES,
      authorization: "Bearer home-run-token",
    }]);
  });
});
