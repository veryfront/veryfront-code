import "#veryfront/schemas/_test-setup.ts";

import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { join } from "veryfront/platform/path";
import { StandaloneMCPServer } from "../../../../cli/mcp/standalone.ts";

interface RpcResponse {
  readonly id: number;
  readonly result?: unknown;
  readonly error?: unknown;
}

interface ToolFileResult {
  readonly path: string;
  readonly created: boolean;
}

interface ToolPayload {
  readonly success: boolean;
  readonly files: readonly ToolFileResult[];
  readonly message: string;
}

describe("standalone MCP auth scaffold integration", () => {
  it("creates auth files and reports conflicts like the development MCP server", async () => {
    const projectDir = await Deno.makeTempDir({ prefix: "vf-standalone-auth-" });
    try {
      const server = new StandaloneMCPServer();
      const first = parseToolPayload(
        await dispatch(server, "tools/call", {
          name: "vf_scaffold",
          arguments: { type: "auth", name: "microsoft-entra", projectPath: projectDir },
        }),
      );
      const second = parseToolPayload(
        await dispatch(server, "tools/call", {
          name: "vf_scaffold",
          arguments: { type: "auth", name: "microsoft-entra", projectPath: projectDir },
        }),
      );

      assertEquals(first.success, true);
      assertEquals(first.files.map((file) => file.path), [
        ".env.auth.example",
        "AUTH_PROVIDER_SETUP.md",
        "AUTH_SETUP.md",
        "veryfront.auth.config.example.ts",
      ]);
      assertEquals(await fileExists(join(projectDir, "veryfront.auth.config.example.ts")), true);
      assertEquals(second.success, false);
      assertEquals(second.files.map((file) => file.path), [
        ".env.auth.example",
        "AUTH_PROVIDER_SETUP.md",
        "AUTH_SETUP.md",
        "veryfront.auth.config.example.ts",
      ]);
      assertEquals(second.message.includes(projectDir), false);
    } finally {
      await Deno.remove(projectDir, { recursive: true });
    }
  });

  it("accepts a relative auth projectPath", async () => {
    const originalCwd = Deno.cwd();
    const parentDir = await Deno.makeTempDir({ prefix: "vf-standalone-relative-" });
    try {
      await Deno.mkdir(join(parentDir, "project"));
      Deno.chdir(parentDir);
      const payload = parseToolPayload(
        await dispatch(
          new StandaloneMCPServer(),
          "tools/call",
          {
            name: "vf_scaffold",
            arguments: { type: "auth", name: "oidc", projectPath: "./project" },
          },
        ),
      );

      assertEquals(payload.success, true);
      assertEquals(payload.files.map((file) => file.path), [
        ".env.auth.example",
        "AUTH_PROVIDER_SETUP.md",
        "AUTH_SETUP.md",
        "veryfront.auth.config.example.ts",
      ]);
      assertEquals(await fileExists(join(parentDir, "project", "AUTH_SETUP.md")), true);
    } finally {
      Deno.chdir(originalCwd);
      await Deno.remove(parentDir, { recursive: true });
    }
  });

  it("reports non-auth scaffold paths without absolute machine paths", async () => {
    const projectDir = await Deno.makeTempDir({ prefix: "vf-standalone-component-" });
    try {
      const payload = parseToolPayload(
        await dispatch(
          new StandaloneMCPServer(),
          "tools/call",
          {
            name: "vf_scaffold",
            arguments: { type: "component", name: "user-card", projectPath: projectDir },
          },
        ),
      );

      assertEquals(payload.success, true);
      assertEquals(payload.files, [{ path: "components/UserCard.tsx", created: true }]);
      assertEquals(payload.message.includes(projectDir), false);
    } finally {
      await Deno.remove(projectDir, { recursive: true });
    }
  });

  it("accepts a relative non-auth projectPath", async () => {
    const originalCwd = Deno.cwd();
    const parentDir = await Deno.makeTempDir({ prefix: "vf-standalone-relative-component-" });
    try {
      await Deno.mkdir(join(parentDir, "project"));
      Deno.chdir(parentDir);
      const payload = parseToolPayload(
        await dispatch(
          new StandaloneMCPServer(),
          "tools/call",
          {
            name: "vf_scaffold",
            arguments: { type: "component", name: "user-card", projectPath: "./project" },
          },
        ),
      );

      assertEquals(payload.success, true);
      assertEquals(payload.files, [{ path: "components/UserCard.tsx", created: true }]);
      assertEquals(
        await fileExists(join(parentDir, "project", "components", "UserCard.tsx")),
        true,
      );
    } finally {
      Deno.chdir(originalCwd);
      await Deno.remove(parentDir, { recursive: true });
    }
  });

  it("accepts an empty methods array and uses the default API method", async () => {
    const projectDir = await Deno.makeTempDir({ prefix: "vf-standalone-empty-methods-" });
    try {
      const payload = parseToolPayload(
        await dispatch(
          new StandaloneMCPServer(),
          "tools/call",
          {
            name: "vf_scaffold",
            arguments: { type: "api", name: "status", methods: [], projectPath: projectDir },
          },
        ),
      );

      assertEquals(payload.success, true);
      const content = await Deno.readTextFile(
        join(projectDir, "app", "api", "status", "route.ts"),
      );
      assertStringIncludes(content, "export const GET");
    } finally {
      await Deno.remove(projectDir, { recursive: true });
    }
  });
});

async function dispatch(
  server: StandaloneMCPServer,
  method: string,
  params: unknown = {},
): Promise<RpcResponse> {
  const handler = Reflect.get(server, "handleRequest");
  if (typeof handler !== "function") throw new Error("Standalone MCP request handler is missing");

  const value: unknown = await Reflect.apply(handler, server, [{
    jsonrpc: "2.0",
    id: 1,
    method,
    params,
  }]);
  if (!isRecord(value) || typeof value.id !== "number") {
    throw new Error("Standalone MCP request handler returned an invalid response");
  }

  return {
    id: value.id,
    ...(Object.hasOwn(value, "result") ? { result: value.result } : {}),
    ...(Object.hasOwn(value, "error") ? { error: value.error } : {}),
  };
}

function parseToolPayload(response: RpcResponse): ToolPayload {
  if (!isRecord(response.result) || !Array.isArray(response.result.content)) {
    throw new Error("Standalone MCP tool response is missing content");
  }
  const first = response.result.content[0];
  if (!isRecord(first) || typeof first.text !== "string") {
    throw new Error("Standalone MCP tool response content is invalid");
  }

  const parsed: unknown = JSON.parse(first.text);
  if (
    !isRecord(parsed) || typeof parsed.success !== "boolean" ||
    !Array.isArray(parsed.files) || typeof parsed.message !== "string"
  ) {
    throw new Error("Standalone MCP tool payload is invalid");
  }
  const files = parsed.files.map((file): ToolFileResult => {
    if (!isRecord(file) || typeof file.path !== "string" || typeof file.created !== "boolean") {
      throw new Error("Standalone MCP tool file result is invalid");
    }
    return { path: file.path, created: file.created };
  });

  return { success: parsed.success, files, message: parsed.message };
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await Deno.lstat(path);
    return true;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return false;
    throw error;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
