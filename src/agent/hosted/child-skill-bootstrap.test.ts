import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { resolveHostedChildAgentExecutionConfig } from "./cloud-agent-child-tools.ts";

function childContext(bootstrapSkill?: string, skills: false | string[] = ["ingest-message"]) {
  const definition = {
    id: "ingestion-agent",
    name: "Ingestion",
    description: "Ingest email",
    instructions: "Follow the child skill.",
    tools: true,
    skills,
    ...(bootstrapSkill === undefined ? {} : { bootstrapSkill }),
  };
  return {
    options: { mcpServers: [] },
    discoveryResult: { agents: new Map([["ingestion-agent", null]]) },
    agentConfigs: new Map([["ingestion-agent", definition]]),
    projectSteeringByAgentId: new Map([["ingestion-agent", {
      getProjectInstructions: async () => "Project instructions",
      getSkillsConfig: async () => [{
        id: "ingestion-agent--ingest-message",
        name: "ingest-message",
        description: "Read the mailbox",
        instructions: "Canonical child instructions",
        allowedTools: [],
        ownerAgentId: "ingestion-agent",
        shortName: "ingest-message",
      }, {
        id: "orchestrator-agent--orchestrate",
        name: "orchestrate",
        description: "Parent skill",
        instructions: "Parent instructions",
        allowedTools: [],
        ownerAgentId: "orchestrator-agent",
        shortName: "orchestrate",
      }],
    }]]),
    trace: (_name: string, operation: () => unknown) => operation(),
  } as never;
}

const parent = {
  authToken: "test-token",
  projectId: "test-project",
  agentId: "orchestrator-agent",
  bootstrapSkill: "orchestrator-agent--orchestrate",
};

Deno.test("hosted child startup selects only the target's configured canonical authorized skill", async () => {
  const config = await resolveHostedChildAgentExecutionConfig(
    childContext("ingest-message"),
    parent,
    "ingestion-agent",
    "test-project",
  );
  assertEquals(
    config && "bootstrapSkill" in config ? config.bootstrapSkill : undefined,
    "ingestion-agent--ingest-message",
  );
});

Deno.test("a child without authored startup never inherits the parent's bootstrap skill", async () => {
  const config = await resolveHostedChildAgentExecutionConfig(
    childContext(),
    parent,
    "ingestion-agent",
    "test-project",
  );
  assertEquals(config && "bootstrapSkill" in config ? config.bootstrapSkill : undefined, undefined);
});

Deno.test("child startup cannot select a sibling skill or expand an empty authorization", async () => {
  for (
    const context of [
      childContext("orchestrator-agent--orchestrate"),
      childContext("ingest-message", false),
    ]
  ) {
    await assertRejects(() =>
      resolveHostedChildAgentExecutionConfig(context, parent, "ingestion-agent", "test-project")
    );
  }
});
