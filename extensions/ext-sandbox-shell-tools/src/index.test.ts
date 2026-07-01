import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { SandboxShellToolsProviderName } from "veryfront/extensions/sandbox";
import extSandboxShellTools, {
  createLazyBashSandboxShellToolsProvider,
  createSandboxShellToolsProvider,
} from "./index.ts";

describe("ext-sandbox-shell-tools", () => {
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
      get: (name) => provided.get(name),
      require: (name) => {
        const value = provided.get(name);
        if (value === undefined) throw new Error(`missing ${name}`);
        return value;
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

  it("reports missing opt-in shell dependencies with an actionable error", async () => {
    const provider = createLazyBashSandboxShellToolsProvider(async () => {
      throw Object.assign(new Error("Cannot find package 'bash-tool'"), {
        code: "ERR_MODULE_NOT_FOUND",
      });
    });
    const sandbox = {
      executeCommand: async () => ({ stdout: "", stderr: "", exitCode: 0 }),
    };

    const error = await assertRejects(
      () =>
        provider({
          sandbox,
          destination: "/workspace",
          promptOptions: { toolPrompt: "tools" },
        }),
      Error,
      "Sandbox shell tools require optional peer dependencies",
    );

    assertStringIncludes(error.message, "bash-tool");
    assertStringIncludes(error.message, "just-bash");
    assertStringIncludes(error.message, "pass createBashTool explicitly");
  });
});
