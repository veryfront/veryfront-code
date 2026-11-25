import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { resolveHostOwnedSourceApiBaseUrl } from "#veryfront/config/host-api-base.ts";
import { sharedAgentKnowledgeSource } from "./agent-stream.handler.ts";

type Payload = Parameters<typeof sharedAgentKnowledgeSource>[0];

const sourceProject = {
  projectId: "00000000-0000-4000-8000-0000000000a1",
  projectSlug: "support-source",
};

function payload(fields: Record<string, unknown>): Payload {
  return {
    sourceProject,
    agentEntrypoint: { path: "agents/support.md" },
    agentSource: { type: "release", releaseId: "release-1" },
    agentConfig: { name: "Support", knowledge: ["knowledge/returns-policy.md"] },
    ...fields,
  } as unknown as Payload;
}

describe("sharedAgentKnowledgeSource", () => {
  it("binds a shared agent's knowledge to its pinned source release", () => {
    assertEquals(sharedAgentKnowledgeSource(payload({}), "source-read-token"), {
      ...sourceProject,
      releaseId: "release-1",
      authToken: "source-read-token",
      apiUrl: resolveHostOwnedSourceApiBaseUrl(),
      knowledge: ["knowledge/returns-policy.md"],
    });
    assertEquals(
      sharedAgentKnowledgeSource(
        payload({
          agentSource: {
            type: "environment",
            environmentName: "Production",
            releaseId: "release-2",
          },
        }),
        "source-read-token",
      )?.releaseId,
      "release-2",
    );
  });

  it("leaves other runs on the consuming project's knowledge", () => {
    // Installed managed agents carry a source project but no exact entrypoint.
    assertEquals(
      sharedAgentKnowledgeSource(payload({ agentEntrypoint: undefined }), "source-read-token"),
      undefined,
    );
    assertEquals(
      sharedAgentKnowledgeSource(payload({ sourceProject: undefined }), "source-read-token"),
      undefined,
    );
    assertEquals(
      sharedAgentKnowledgeSource(
        payload({ agentSource: { type: "branch", branch: "main" } }),
        "source-read-token",
      ),
      undefined,
    );
    assertEquals(sharedAgentKnowledgeSource(payload({}), ""), undefined);
    // Without the signed selection there is nothing to cap reads with.
    assertEquals(
      sharedAgentKnowledgeSource(payload({ agentConfig: undefined }), "source-read-token"),
      undefined,
    );
    assertEquals(
      sharedAgentKnowledgeSource(
        payload({ agentConfig: { name: "Support" } }),
        "source-read-token",
      ),
      undefined,
    );
  });
});
