import "#veryfront/schemas/_test-setup.ts";
import "./_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { createLoadSkillTool } from "./tools.ts";
import { getFrameworkSkillBootstrapInput } from "./loader-provenance.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";

describe("framework skill loader provenance", () => {
  it("bootstrap input follows factory provenance across aliases, not tool names", () => {
    const loader = createLoadSkillTool();
    assertEquals(
      getFrameworkSkillBootstrapInput({ ...loader, id: "veryfront__load_skill" }, "plan"),
      {
        skillId: "plan",
      },
    );
    assertEquals(
      getFrameworkSkillBootstrapInput({ ...loader, execute: () => "forged" }, "plan"),
      undefined,
    );
  });

  it("bootstrap provenance lookup does not invoke executor getters or proxy traps", () => {
    let calls = 0;
    const getter = {
      get execute() {
        calls++;
        throw new Error("getter invoked");
      },
    };
    assertEquals(getFrameworkSkillBootstrapInput(getter, "plan"), undefined);
    const proxy = new Proxy({}, {
      getOwnPropertyDescriptor() {
        calls++;
        throw new Error("trap invoked");
      },
    });
    assertEquals(getFrameworkSkillBootstrapInput(proxy, "plan"), undefined);
    assertEquals(calls, 0);
  });

  it("host materialization preserves factory loader provenance", async () => {
    const { createToolsFromHostDefinitions } = await import("#veryfront/tool/host-tools.ts");
    const loader = createLoadSkillTool();
    const hosted = createToolsFromHostDefinitions({ load_skill: loader });
    assertEquals(getFrameworkSkillBootstrapInput(hosted.load_skill, "plan"), { skillId: "plan" });
    const project = createToolsFromHostDefinitions({
      load_skill: { ...loader, execute: () => "project" },
    });
    assertEquals(getFrameworkSkillBootstrapInput(project.load_skill, "plan"), undefined);
  });

  it("tracing then host materialization preserves only factory loader provenance", async () => {
    const { createToolsFromHostDefinitions } = await import("#veryfront/tool/host-tools.ts");
    const { traceHostTools } = await import("#veryfront/tool/tracing.ts");
    const { scopeHostedRuntimeTools } = await import(
      "#veryfront/agent/hosted/default-chat-runtime.ts"
    );
    const loader = createLoadSkillTool();
    const traced = traceHostTools({
      load_skill: loader,
      project_loader: { ...loader, execute: () => "project" },
    }, { trace: (_name, operation) => operation() });
    const hosted = scopeHostedRuntimeTools({
      tools: createToolsFromHostDefinitions(traced),
      taskContext: {
        authToken: "test-token",
        projectId: "test-project",
        branchId: null,
        model: "test/model",
      },
      cloudContext: {
        apiBaseUrl: "https://api.example.com",
        apiToken: "test-token",
        serviceLayer: "cloud",
      },
    });
    assertEquals(getFrameworkSkillBootstrapInput(hosted.load_skill, "plan"), { skillId: "plan" });
    assertEquals(getFrameworkSkillBootstrapInput(hosted.project_loader, "plan"), undefined);
  });
});
