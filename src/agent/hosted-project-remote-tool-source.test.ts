import { assertEquals, assertRejects } from "@std/assert";
import type { RemoteToolSource, ToolDefinition, ToolExecutionContext } from "#veryfront/tool";
import { createHostedProjectRemoteToolSource } from "./hosted-project-remote-tool-source.ts";

function projectFileTool(name: string): ToolDefinition {
  return {
    name,
    description: `${name} description`,
    parameters: {
      type: "object",
      properties: {
        project_reference: { type: "string" },
        path: { type: "string" },
      },
      required: ["project_reference", "path"],
    },
  };
}

function navigationTool(name: string): ToolDefinition {
  return {
    name,
    description: `${name} description`,
    parameters: {
      type: "object",
      properties: {
        project_id: { type: "string" },
      },
      required: ["project_id"],
    },
  };
}

function createRemoteSource(input: {
  tools: ToolDefinition[];
  execute?: (
    toolName: string,
    args: unknown,
    context?: ToolExecutionContext,
  ) => Promise<unknown> | unknown;
}): RemoteToolSource {
  return {
    id: "source-1",
    listTools: () => Promise.resolve(input.tools),
    executeTool: (toolName, args, context) =>
      input.execute?.(toolName, args, context) ?? { ok: true },
  };
}

Deno.test("createHostedProjectRemoteToolSource scopes tool listings and hydrates project inputs", async () => {
  const executeCalls: Array<{ toolName: string; args: unknown; context?: ToolExecutionContext }> =
    [];
  const source = createHostedProjectRemoteToolSource({
    source: createRemoteSource({
      tools: [projectFileTool("update_file"), navigationTool("studio_open_project")],
      execute: (toolName, args, context) => {
        executeCalls.push({ toolName, args, context });
        return { ok: true };
      },
    }),
    defaultProjectId: () => "project-1",
    projectScopedRemoteToolOptions: {
      projectNavigationToolNames: ["studio_open_project"],
    },
  });

  assertEquals(
    (await source.listTools()).map((tool) => tool.name),
    ["update_file", "studio_open_project"],
  );

  await source.executeTool("update_file", { path: "AGENTS.md" });

  assertEquals(executeCalls, [
    {
      toolName: "update_file",
      args: { path: "AGENTS.md", project_reference: "project-1" },
      context: { projectId: "project-1" },
    },
  ]);
});

Deno.test("createHostedProjectRemoteToolSource applies local input preparation before execution", async () => {
  let executedArgs: unknown;
  const source = createHostedProjectRemoteToolSource({
    source: createRemoteSource({
      tools: [projectFileTool("create_file")],
      execute: (_toolName, args) => {
        executedArgs = args;
        return { ok: true };
      },
    }),
    defaultProjectId: "project-1",
    prepareToolInput: ({ toolInput }) => ({
      ...toolInput,
      path: "research/report.md",
    }),
  });

  await source.executeTool("create_file", { content: "hello" });

  assertEquals(executedArgs, {
    content: "hello",
    path: "research/report.md",
    project_reference: "project-1",
  });
});

Deno.test("createHostedProjectRemoteToolSource retries configured write collisions with the fallback tool", async () => {
  const executeCalls: string[] = [];
  const source = createHostedProjectRemoteToolSource({
    source: createRemoteSource({
      tools: [projectFileTool("create_file"), projectFileTool("update_file")],
      execute: (toolName) => {
        executeCalls.push(toolName);
        return toolName === "create_file"
          ? { isError: true, message: "file already exists" }
          : { ok: true };
      },
    }),
    defaultProjectId: "project-1",
    shouldRetryWithTool: ({ error }) => {
      if (typeof error !== "object" || error === null) {
        return false;
      }
      return Reflect.get(error, "message") === "file already exists";
    },
  });

  assertEquals(await source.executeTool("create_file", { path: "report.md" }), { ok: true });
  assertEquals(executeCalls, ["create_file", "update_file"]);
});

Deno.test("createHostedProjectRemoteToolSource retries thrown errors and rethrows non-retry errors", async () => {
  const executeCalls: string[] = [];
  const source = createHostedProjectRemoteToolSource({
    source: createRemoteSource({
      tools: [projectFileTool("create_file"), projectFileTool("update_file")],
      execute: (toolName) => {
        executeCalls.push(toolName);
        if (toolName === "create_file") {
          throw new Error("file already exists");
        }
        return { ok: true };
      },
    }),
    defaultProjectId: "project-1",
    shouldRetryWithTool: ({ error }) =>
      error instanceof Error && error.message === "file already exists",
  });

  assertEquals(await source.executeTool("create_file", { path: "report.md" }), { ok: true });
  assertEquals(executeCalls, ["create_file", "update_file"]);

  const failingSource = createHostedProjectRemoteToolSource({
    source: createRemoteSource({
      tools: [projectFileTool("create_file")],
      execute: () => {
        throw new Error("permission denied");
      },
    }),
    defaultProjectId: "project-1",
    shouldRetryWithTool: () => false,
  });

  await assertRejects(
    () => failingSource.executeTool("create_file", { path: "report.md" }),
    Error,
    "permission denied",
  );
});

Deno.test("createHostedProjectRemoteToolSource reports project navigation and steering mutations", async () => {
  const switchedProjects: string[] = [];
  const mutations: Array<{ instructionsChanged: boolean; skillsChanged: boolean }> = [];
  const source = createHostedProjectRemoteToolSource({
    source: createRemoteSource({
      tools: [navigationTool("studio_open_project"), projectFileTool("update_file")],
      execute: (toolName) => {
        if (toolName === "studio_open_project") {
          return { success: true, project_id: "project-2" };
        }
        return { success: true };
      },
    }),
    defaultProjectId: () => "project-1",
    projectScopedRemoteToolOptions: {
      projectNavigationToolNames: ["studio_open_project"],
    },
    onProjectSwitch: (projectId) => {
      switchedProjects.push(projectId);
    },
    onSteeringMutation: (mutation) => {
      mutations.push({
        instructionsChanged: mutation.instructionsChanged,
        skillsChanged: mutation.skillsChanged,
      });
    },
  });

  await source.executeTool("studio_open_project", { project_id: "project-2" });
  await source.executeTool("update_file", { path: "AGENTS.md" });

  assertEquals(switchedProjects, ["project-2"]);
  assertEquals(mutations, [{ instructionsChanged: true, skillsChanged: false }]);
});

Deno.test("createHostedProjectRemoteToolSource skips mutation callbacks for failed results", async () => {
  let mutationCount = 0;
  const source = createHostedProjectRemoteToolSource({
    source: createRemoteSource({
      tools: [projectFileTool("update_file")],
      execute: () => ({ isError: true }),
    }),
    defaultProjectId: "project-1",
    onSteeringMutation: () => {
      mutationCount += 1;
    },
  });

  assertEquals(await source.executeTool("update_file", { path: "AGENTS.md" }), { isError: true });
  assertEquals(mutationCount, 0);
});
