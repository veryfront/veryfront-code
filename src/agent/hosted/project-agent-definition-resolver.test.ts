import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  fetchHostedProjectAgentDefinition,
  toRuntimeAgentDefinitionFromAgentDocument,
} from "./project-agent-definition-resolver.ts";

const BRANCH_ID = "00000000-0000-4000-8000-000000000001";

function stubFetch(response: Response, urls: string[] = []): typeof fetch {
  return (input) => {
    urls.push(String(input instanceof Request ? input.url : input));
    return Promise.resolve(response);
  };
}

describe("project agent definition resolver", () => {
  it("maps tools: false to no tools and denies the skill loader", () => {
    const definition = toRuntimeAgentDefinitionFromAgentDocument({
      id: "triage",
      name: "Triage",
      system_prompt: "Do not use tools.",
      all_tools_enabled: false,
      tool_ids: [],
      tools: false,
      skill_selection: { kind: "omitted", skill_ids: ["notes"] },
    }, "triage");

    assertEquals(definition.tools, []);
    assertEquals(definition.deniedTools, ["load_skill", "veryfront__load_skill"]);
    assertEquals(definition.instructions, "Do not use tools.");
    assertEquals(definition.skills, undefined);
  });

  it("maps tool_ids, all tools, and explicit skills", () => {
    assertEquals(
      toRuntimeAgentDefinitionFromAgentDocument({
        id: "reader",
        all_tools_enabled: false,
        tool_ids: ["get_file"],
        tools: ["get_file"],
        skill_selection: { kind: "explicit", skill_ids: ["notes"] },
        max_steps: 4,
      }, "reader"),
      {
        id: "reader",
        name: "reader",
        description: "",
        instructions: "",
        maxSteps: 4,
        skills: ["notes"],
        tools: ["get_file"],
      },
    );
    assertEquals(
      toRuntimeAgentDefinitionFromAgentDocument({ id: "all", all_tools_enabled: true }, "all")
        .tools,
      true,
    );
  });

  it("rejects a document for a different agent", () => {
    let error: unknown;
    try {
      toRuntimeAgentDefinitionFromAgentDocument({ id: "other" }, "triage");
    } catch (caught) {
      error = caught;
    }
    assertEquals(error instanceof Error, true);
  });

  it("returns undefined for a missing agent and reads preview branches", async () => {
    const urls: string[] = [];
    const definition = await fetchHostedProjectAgentDefinition({
      apiUrl: "https://api.example.com",
      authToken: "token-1",
      projectId: "project-1",
      agentId: "missing",
      branchId: BRANCH_ID,
      fetch: stubFetch(new Response(null, { status: 404 }), urls),
    });

    assertEquals(definition, undefined);
    assertEquals(urls, [
      `https://api.example.com/projects/project-1/agents/missing?source_target_kind=preview_branch&target_branch_id=${BRANCH_ID}`,
    ]);
  });

  it("fails closed when the lookup fails", async () => {
    await assertRejects(
      () =>
        fetchHostedProjectAgentDefinition({
          apiUrl: "https://api.example.com",
          authToken: "token-1",
          projectId: "project-1",
          agentId: "triage",
          fetch: stubFetch(new Response(null, { status: 503 })),
        }),
      Error,
      "Project agent lookup failed (503)",
    );
  });
});
