import "#veryfront/schemas/_test-setup.ts";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd";
import { assertEquals, assertExists, assertStringIncludes } from "#veryfront/testing/assert";
import type { CreateSandboxBashTool, SandboxShellToolSet } from "./shell-tools.ts";
import {
  createAgentServiceSandboxClient,
  createAgentServiceSandboxTools,
  createProjectScopedExecOptions,
  unwrapSandboxWorkingDirectoryCommand,
} from "./agent-service-tools.ts";
import {
  clearSandboxEnv,
  type FetchCall,
  installMockFetch,
  jsonBody,
  jsonResponse,
  type MockResponseEntry,
  ndjsonResponse,
} from "./sandbox.test-helpers.ts";

const originalFetch = globalThis.fetch;
let fetchCalls: FetchCall[] = [];
let fetchResponses: MockResponseEntry[] = [];

const createBashTool: CreateSandboxBashTool = async (input) => {
  assertEquals(input.destination, "/workspace");
  assertStringIncludes(input.promptOptions.toolPrompt, "agent-browser");
  return {
    tools: {
      bash: {
        description: "Run commands",
        execute: async (toolInput: unknown) => toolInput,
      },
      readFile: { description: "Read file" },
      writeFile: { description: "Write file" },
    },
  };
};

function mockFetch(responses: MockResponseEntry[]) {
  fetchResponses = [...responses];
  fetchCalls = [];
  globalThis.fetch = installMockFetch({ calls: fetchCalls, responses: fetchResponses });
}

function createSandboxSessionResponse(
  overrides: Partial<{ id: string; endpoint: string; status: string }> = {},
): Response {
  return jsonResponse({
    id: "sandbox-1",
    endpoint: "https://sandbox.example.com",
    status: "running",
    ...overrides,
  });
}

function createOkResponse(): Response {
  return jsonResponse({ ok: true });
}

function createCommandPayload(overrides: Record<string, unknown> = {}) {
  return {
    id: "command-1",
    status: "running",
    exit_code: null,
    signal: null,
    started_at: "2026-03-19T10:00:00.000Z",
    finished_at: null,
    heartbeat_status: "healthy",
    last_heartbeat_at: "2026-03-19T10:00:05.000Z",
    last_heartbeat_error: null,
    heartbeat_failure_count: 0,
    ...overrides,
  };
}

async function executeStartBackgroundCommand(
  tools: SandboxShellToolSet,
  command: string,
): Promise<unknown> {
  const execute = tools.start_background_command?.execute;
  assertExists(execute);
  return await execute({ command });
}

describe("sandbox/agent-service-tools", () => {
  beforeEach(() => {
    fetchCalls = [];
    fetchResponses = [];
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    clearSandboxEnv();
  });

  it("creates shell tools and async background command tools", async () => {
    mockFetch([]);

    const { tools } = await createAgentServiceSandboxTools({
      authToken: "test-token",
      apiUrl: "https://api.example.com",
      projectId: "project-123",
      createBashTool,
    });

    assertExists(tools.bash);
    assertExists(tools.sandbox_read_file);
    assertExists(tools.sandbox_write_file);
    assertExists(tools.start_background_command);
    assertExists(tools.get_background_command);
    assertExists(tools.get_background_command_output);
    assertExists(tools.cancel_background_command);
    assertEquals(tools.readFile, undefined);
    assertEquals(tools.writeFile, undefined);
  });

  it("passes the latest project reference through exec and background-command requests", async () => {
    mockFetch([
      createSandboxSessionResponse(),
      createOkResponse(),
      ndjsonResponse([{ type: "stdout", data: "ok" }, { type: "exit", exitCode: 0 }]),
      jsonResponse(createCommandPayload()),
      createOkResponse(),
    ]);

    let projectId = "project-1";
    const sandbox = createAgentServiceSandboxClient({
      authToken: "test-token",
      apiUrl: "https://api.example.com",
      getProjectId: () => projectId,
    });

    projectId = "project-2";

    try {
      assertEquals(await sandbox.executeCommand("echo ok"), {
        stdout: "ok",
        stderr: "",
        exitCode: 0,
      });
      assertEquals(await sandbox.startBackgroundCommand("npm test"), {
        id: "command-1",
        status: "running",
        exitCode: null,
        signal: null,
        startedAt: "2026-03-19T10:00:00.000Z",
        finishedAt: null,
        heartbeatStatus: "healthy",
        lastHeartbeatAt: "2026-03-19T10:00:05.000Z",
        lastHeartbeatError: null,
        heartbeatFailureCount: 0,
      });
    } finally {
      await sandbox.close();
    }

    assertEquals(jsonBody(fetchCalls, 0), { project_id: "project-2" });
    assertEquals(jsonBody(fetchCalls, 2), {
      command: "echo ok",
      projectReference: "project-2",
    });
    assertEquals(jsonBody(fetchCalls, 3), {
      command: "npm test",
      cwd: "/workspace",
      projectReference: "project-2",
    });
  });

  it("strips bash-tool workspace prefixes from async background command tool commands", async () => {
    mockFetch([
      createSandboxSessionResponse(),
      createOkResponse(),
      jsonResponse(createCommandPayload()),
      createOkResponse(),
    ]);

    const { closeSandbox, tools } = await createAgentServiceSandboxTools({
      authToken: "test-token",
      apiUrl: "https://api.example.com",
      projectId: "project-123",
      createBashTool,
    });

    try {
      await executeStartBackgroundCommand(
        tools,
        'mkdir -p /tmp/bash-tool && cd "/workspace" && python3 process_pdf.py',
      );
    } finally {
      await closeSandbox();
    }

    assertEquals(jsonBody(fetchCalls, 2), {
      command: "python3 process_pdf.py",
      cwd: "/workspace",
      projectReference: "project-123",
    });
  });

  it("normalizes command and project helper outputs", () => {
    assertEquals(
      unwrapSandboxWorkingDirectoryCommand('mkdir -p /tmp/bash-tool && cd "/workspace" && echo ok'),
      "echo ok",
    );
    assertEquals(unwrapSandboxWorkingDirectoryCommand("  echo ok  "), "echo ok");
    assertEquals(createProjectScopedExecOptions("project-123"), {
      projectReference: "project-123",
    });
    assertEquals(createProjectScopedExecOptions(null), {});
  });
});
