import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import type { HostToolDefinition, HostToolSet } from "#veryfront/tool";
import {
  wrapHostedChildProjectSwitchTool,
  wrapHostedChildSteeringMutationTool,
} from "./child-steering-tools.ts";
import {
  createUnconfirmedProjectContextSwitchResult,
  INVALID_AGENT_PROJECT_REFERENCE_MESSAGE,
} from "../project/context.ts";
import { MAX_OPAQUE_ID_CODE_UNITS } from "#veryfront/utils/project-identity.ts";

Deno.test("wrapHostedChildSteeringMutationTool leaves tools without execute unchanged", () => {
  const toolDefinition: HostToolDefinition = { description: "no execute" };

  const wrapped = wrapHostedChildSteeringMutationTool({
    toolName: "create_file",
    toolDefinition,
    activeProjectId: "project-1",
  });

  assertEquals(wrapped, toolDefinition);
});

Deno.test("wrapHostedChildSteeringMutationTool reports successful steering mutations", async () => {
  const mutations: unknown[] = [];
  const wrapped = wrapHostedChildSteeringMutationTool({
    toolName: "create_file",
    toolDefinition: {
      execute: () => ({ structuredContent: { success: true } }),
    },
    activeProjectId: "project-1",
    activeBranchId: "branch-1",
    onMutation: (mutation) => {
      mutations.push(mutation);
    },
  });

  const result = await wrapped.execute?.({
    project_reference: "project-1",
    branch_id: "branch-1",
    path: "AGENTS.md",
  });

  assertEquals(result, { structuredContent: { success: true } });
  assertEquals(mutations, [{ instructionsChanged: true, skillsChanged: false }]);
});

Deno.test("wrapHostedChildSteeringMutationTool ignores failed or irrelevant mutations", async () => {
  let mutationCount = 0;
  const failedTool = wrapHostedChildSteeringMutationTool({
    toolName: "update_file",
    toolDefinition: {
      execute: () => ({ structuredContent: { success: false } }),
    },
    activeProjectId: "project-1",
    onMutation: () => {
      mutationCount += 1;
    },
  });
  const unrelatedTool = wrapHostedChildSteeringMutationTool({
    toolName: "update_file",
    toolDefinition: {
      execute: () => ({ structuredContent: { success: true } }),
    },
    activeProjectId: "project-1",
    onMutation: () => {
      mutationCount += 1;
    },
  });

  await failedTool.execute?.({ project_reference: "project-1", path: "AGENTS.md" });
  await unrelatedTool.execute?.({ project_reference: "project-2", path: "AGENTS.md" });

  assertEquals(mutationCount, 0);
});

Deno.test("wrapHostedChildProjectSwitchTool leaves missing switch tools unchanged", () => {
  const tools: HostToolSet = {};

  wrapHostedChildProjectSwitchTool({
    tools,
    onConfirmedProjectSwitch: () => {
      throw new Error("unexpected project switch");
    },
  });

  assertEquals(tools, {});
});

Deno.test("wrapHostedChildProjectSwitchTool reports confirmed project switches", async () => {
  const switchedProjects: Array<{ projectId: string; projectSlug?: string }> = [];
  const tools: HostToolSet = {
    studio_open_project: {
      execute: () => ({
        structuredContent: { success: true, project_id: "project-2", slug: "project-two" },
      }),
    },
  };

  wrapHostedChildProjectSwitchTool({
    tools,
    onConfirmedProjectSwitch: (projectId, projectSlug) => {
      switchedProjects.push({ projectId, projectSlug });
    },
  });

  const result = await tools.studio_open_project?.execute?.({ project_reference: "project-two" });

  assertEquals(result, {
    structuredContent: { success: true, project_id: "project-2", slug: "project-two" },
  });
  assertEquals(switchedProjects, [{ projectId: "project-2", projectSlug: "project-two" }]);
});

Deno.test("wrapHostedChildProjectSwitchTool rejects unsafe references before execution", async () => {
  let executeCalls = 0;
  let switchCalls = 0;
  const tools: HostToolSet = {
    studio_open_project: {
      execute: () => {
        executeCalls += 1;
        return {
          structuredContent: {
            success: true,
            project_id: "project-2",
            slug: "project-two",
          },
        };
      },
    },
  };

  wrapHostedChildProjectSwitchTool({
    tools,
    onConfirmedProjectSwitch: () => {
      switchCalls += 1;
    },
  });

  for (
    const projectReference of [
      undefined,
      "",
      " project-two",
      "project-\ntwo",
      "p".repeat(MAX_OPAQUE_ID_CODE_UNITS + 1),
    ]
  ) {
    await assertRejects(
      () =>
        tools.studio_open_project?.execute?.(
          projectReference === undefined ? {} : { project_reference: projectReference },
        ) as Promise<unknown>,
      TypeError,
      INVALID_AGENT_PROJECT_REFERENCE_MESSAGE,
    );
  }

  assertEquals(executeCalls, 0);
  assertEquals(switchCalls, 0);
});

Deno.test("wrapHostedChildProjectSwitchTool confirms slug requests from returned canonical project output", async () => {
  const switchedProjects: Array<{ projectId: string; projectSlug?: string }> = [];
  const tools: HostToolSet = {
    studio_open_project: {
      execute: () => ({
        structuredContent: {
          success: true,
          project_id: "11111111-1111-4111-8111-111111111111",
          slug: "demo-project",
        },
      }),
    },
  };

  wrapHostedChildProjectSwitchTool({
    tools,
    onConfirmedProjectSwitch: (projectId, projectSlug) => {
      switchedProjects.push({ projectId, projectSlug });
    },
  });

  await tools.studio_open_project?.execute?.({ project_reference: "demo-project" });

  assertEquals(switchedProjects, [{
    projectId: "11111111-1111-4111-8111-111111111111",
    projectSlug: "demo-project",
  }]);
});

Deno.test("wrapHostedChildProjectSwitchTool fails closed for unconfirmed success", async () => {
  const unconfirmedCases: Array<{
    projectReference: string;
    result: unknown;
  }> = [
    {
      projectReference: "project-two",
      result: { structuredContent: { success: true, project_id: "project-3" } },
    },
    {
      projectReference: "project-two",
      result: {
        structuredContent: {
          success: true,
          project_id: "11111111-1111-4111-8111-111111111111",
        },
      },
    },
    {
      projectReference: "project-two",
      result: {
        structuredContent: {
          success: true,
          project_id: "   ",
          slug: "project-two",
        },
      },
    },
    {
      projectReference: "project-2",
      result: {
        structuredContent: {
          success: true,
          project_id: "project-2",
          slug: "project\u0000two",
        },
      },
    },
    {
      projectReference: "project-2",
      result: {
        success: true,
        project_id: "project-2",
        structuredContent: null,
      },
    },
  ];

  for (const testCase of unconfirmedCases) {
    let switchCount = 0;
    const tools: HostToolSet = {
      studio_open_project: {
        execute: () => testCase.result,
      },
    };

    wrapHostedChildProjectSwitchTool({
      tools,
      onConfirmedProjectSwitch: () => {
        switchCount += 1;
      },
    });

    assertEquals(
      await tools.studio_open_project?.execute?.({
        project_reference: testCase.projectReference,
      }),
      createUnconfirmedProjectContextSwitchResult(),
    );
    assertEquals(switchCount, 0);
  }
});

Deno.test("wrapHostedChildProjectSwitchTool preserves contradictory remote failures", async () => {
  const failures = [
    {
      isError: true,
      message: "upstream denied",
      structuredContent: {
        success: true,
        project_id: "project-2",
        slug: "project-two",
      },
    },
    {
      success: false,
      structuredContent: {
        success: true,
        project_id: "project-2",
        slug: "project-two",
      },
    },
  ];

  for (const failure of failures) {
    let switchCount = 0;
    const tools: HostToolSet = {
      studio_open_project: {
        execute: () => failure,
      },
    };

    wrapHostedChildProjectSwitchTool({
      tools,
      onConfirmedProjectSwitch: () => {
        switchCount += 1;
      },
    });

    assertEquals(
      await tools.studio_open_project?.execute?.({ project_reference: "project-two" }),
      failure,
    );
    assertEquals(switchCount, 0);
  }
});
