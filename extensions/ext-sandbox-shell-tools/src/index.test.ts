import { assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { SandboxShellToolsProviderName } from "veryfront/extensions/sandbox";
import extSandboxShellTools, {
  createBashSandboxShellToolsProvider,
  createSandboxShellToolsProvider,
} from "./index.ts";
import { normalizeBashToolSet } from "../../../src/sandbox/shell-tools.ts";

describe("ext-sandbox-shell-tools", () => {
  it("exposes the real bash command schema to the runtime", async () => {
    const { tools } = await createBashSandboxShellToolsProvider({
      sandbox: {
        executeCommand: async () => ({ stdout: "ok", stderr: "", exitCode: 0 }),
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
      executeCommand: async () => ({ stdout: "", stderr: "", exitCode: 0 }),
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
