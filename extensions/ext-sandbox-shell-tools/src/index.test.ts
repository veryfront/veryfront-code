import { assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { SandboxShellToolsProviderName } from "veryfront/extensions/sandbox";
import extSandboxShellTools, {
  createBashSandboxShellToolsProvider,
  createSandboxShellToolsProvider,
} from "./index.ts";
import { normalizeBashToolSet } from "#veryfront/sandbox/shell-tools.ts";

describe("ext-sandbox-shell-tools", () => {
  it("exposes the real bash command schema to the runtime", async () => {
    const { tools } = await createBashSandboxShellToolsProvider({
      sandbox: {
        runCommand: async () => ({ stdout: "ok", stderr: "", exitCode: 0 }),
      },
      destination: "/workspace",
      promptOptions: { toolPrompt: "tools" },
    });
    const bash = normalizeBashToolSet(tools).bash;
    assertEquals(bash?.inputSchemaJson?.properties?.command?.type, "string");
    assertEquals(bash?.inputSchemaJson?.required, ["command"]);
  });
  it("declares the sandbox shell tools contract", () => {
    const extension = extSandboxShellTools();

    assertEquals(extension.name, "ext-sandbox-shell-tools");
    assertEquals(extension.contracts?.provides, [SandboxShellToolsProviderName]);
    assertEquals(extension.capabilities, [
      { type: "sandbox:execute", tools: ["bash"] },
    ]);
  });

  it("registers a provider during setup", () => {
    const provided = new Map<string, unknown>();
    const extension = extSandboxShellTools();

    extension.setup?.({
      get: <T>(name: string) => provided.get(name) as T | undefined,
      require: <T>(name: string) => {
        const value = provided.get(name);
        if (value === undefined) throw new Error(`missing ${name}`);
        return value as T;
      },
      provide: (name, impl) => provided.set(name, impl),
      config: {},
      logger: {
        debug() {},
        info() {},
        warn() {},
        error() {},
      },
    });

    assertEquals(typeof provided.get(SandboxShellToolsProviderName), "function");
  });

  it("passes sandbox shell tool input through to the bash-tool factory", async () => {
    let received: unknown;
    const provider = createSandboxShellToolsProvider((input) => {
      received = input;
      return Promise.resolve({ tools: { bash: { description: "Run commands" } } });
    });
    const sandbox = {
      runCommand: async () => ({ stdout: "", stderr: "", exitCode: 0 }),
    };

    const result = await provider({
      sandbox,
      destination: "/workspace",
      promptOptions: { toolPrompt: "tools" },
    });

    assertEquals(received, {
      sandbox,
      destination: "/workspace",
      promptOptions: { toolPrompt: "tools" },
    });
    assertEquals(result, { tools: { bash: { description: "Run commands" } } });
  });
});

describe("sandbox shell execution parity", () => {
  it("executes commands in the destination and preserves bounded results", async () => {
    let received = "";
    const { tools } = await createBashSandboxShellToolsProvider({
      sandbox: {
        runCommand: async (command) => {
          received = command;
          return { stdout: "x".repeat(30_001), stderr: "warning", exitCode: 7 };
        },
      },
      destination: "/workspace",
      promptOptions: { toolPrompt: "custom tools" },
    });
    const bash = normalizeBashToolSet(tools).bash!;
    const result = await bash.execute!({ command: "echo hello" }) as {
      stdout: string;
      stderr: string;
      exitCode: number;
    };
    assertEquals(received, 'cd "/workspace" && echo hello');
    assertEquals(
      result.stdout,
      "x".repeat(30_000) + "\n\n[stdout truncated: 1 characters removed]",
    );
    assertEquals(result.stderr, "warning");
    assertEquals(result.exitCode, 7);
    assertEquals(bash.description?.includes("custom tools"), true);
  });

  it("resolves file paths from the destination and keeps read/write schemas", async () => {
    let readPath = "";
    let written: unknown[] = [];
    const { tools } = await createBashSandboxShellToolsProvider({
      sandbox: {
        runCommand: async () => ({ stdout: "", stderr: "", exitCode: 0 }),
        readFile: (path) => {
          readPath = path;
          return "file contents";
        },
        writeFiles: (files) => {
          written = files;
        },
      },
      destination: "/workspace",
      promptOptions: { toolPrompt: "tools" },
    });
    const normalized = normalizeBashToolSet(tools);
    assertEquals(normalized.readFile!.inputSchemaJson?.required, ["path"]);
    assertEquals(normalized.writeFile!.inputSchemaJson?.required, ["path", "content"]);
    assertEquals(await normalized.readFile!.execute!({ path: "src/../a.txt" }), {
      content: "file contents",
    });
    assertEquals(readPath, "/workspace/a.txt");
    assertEquals(await normalized.writeFile!.execute!({ path: "/tmp/a.txt", content: "new" }), {
      success: true,
    });
    assertEquals(written, [{ path: "/tmp/a.txt", content: "new" }]);
  });
});
