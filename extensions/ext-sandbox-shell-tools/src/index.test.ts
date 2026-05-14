import { assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { SandboxShellToolsProviderName } from "veryfront/extensions/sandbox";
import extSandboxShellTools, { createSandboxShellToolsProvider } from "./index.ts";

describe("ext-sandbox-shell-tools", () => {
  it("declares the sandbox shell tools contract", () => {
    const extension = extSandboxShellTools();

    assertEquals(extension.name, "ext-sandbox-shell-tools");
    assertEquals(extension.capabilities, [
      { type: "contract", name: SandboxShellToolsProviderName },
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
});
