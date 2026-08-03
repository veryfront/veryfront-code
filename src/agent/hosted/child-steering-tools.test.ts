import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import type { HostToolDefinition, HostToolSet } from "#veryfront/tool";
import {
  wrapHostedChildProjectSwitchTool,
  wrapHostedChildSteeringMutationTool,
} from "./child-steering-tools.ts";
import { createUnconfirmedProjectContextSwitchResult } from "../project/context.ts";

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
  const switchedProjectIds: string[] = [];
  const tools: HostToolSet = {
    studio_open_project: {
      execute: () => ({
        structuredContent: { success: true, project_id: "project-2", slug: "project-two" },
      }),
    },
  };

  wrapHostedChildProjectSwitchTool({
    tools,
    onConfirmedProjectSwitch: (projectId) => {
      switchedProjectIds.push(projectId);
    },
  });

  const result = await tools.studio_open_project?.execute?.({ project_reference: "project-two" });

  assertEquals(result, {
    structuredContent: { success: true, project_id: "project-2", slug: "project-two" },
  });
  assertEquals(switchedProjectIds, ["project-2"]);
});

Deno.test("wrapHostedChildProjectSwitchTool confirms slug requests from returned canonical project output", async () => {
  const switchedProjectIds: string[] = [];
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
    onConfirmedProjectSwitch: (projectId, confirmedProject) => {
      switchedProjectIds.push(projectId);
      if (confirmedProject) {
        switchedProjects.push(confirmedProject);
      }
    },
  });

  await tools.studio_open_project?.execute?.({ project_reference: "demo-project" });

  assertEquals(switchedProjectIds, ["11111111-1111-4111-8111-111111111111"]);
  assertEquals(switchedProjects, [{
    projectId: "11111111-1111-4111-8111-111111111111",
    projectSlug: "demo-project",
  }]);
});

Deno.test("wrapHostedChildProjectSwitchTool fails closed on claimed but mismatched switches", async () => {
  const switchedProjects: Array<{ projectId: string; projectSlug?: string }> = [];
  const tools: HostToolSet = {
    studio_open_project: {
      execute: () => ({ structuredContent: { success: true, project_id: "project-3" } }),
    },
  };

  wrapHostedChildProjectSwitchTool({
    tools,
    onConfirmedProjectSwitch: (_projectId, confirmedProject) => {
      if (confirmedProject) {
        switchedProjects.push(confirmedProject);
      }
    },
  });

  const result = await tools.studio_open_project?.execute?.({ project_reference: "project-two" });

  assertEquals(result, createUnconfirmedProjectContextSwitchResult());
  assertEquals(switchedProjects, []);
});

Deno.test("wrapHostedChildProjectSwitchTool preserves upstream navigation failures", async () => {
  const failure = {
    structuredContent: {
      success: false,
      error: "not_found",
      message: "Project not found",
    },
  };
  const tools: HostToolSet = {
    studio_open_project: { execute: () => failure },
  };

  wrapHostedChildProjectSwitchTool({
    tools,
    onConfirmedProjectSwitch: () => {
      throw new Error("unexpected project switch");
    },
  });

  assertEquals(
    await tools.studio_open_project?.execute?.({ project_reference: "missing-project" }),
    failure,
  );
});
