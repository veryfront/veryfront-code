import { assertEquals, assertExists, assertRejects } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { SandboxShellToolsProviderName } from "veryfront/extensions/sandbox";
import extSandboxShellTools, {
  createBashSandboxShellToolsProvider,
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

  it("converts provider-owned schemas to JSON Schema before crossing the contract", async () => {
    const inputSchema = {
      "~standard": {
        version: 1,
        vendor: "test",
        validate: (value: unknown) => ({ value }),
        jsonSchema: {
          input: () => ({
            type: "object",
            properties: { command: { type: "string" } },
            required: ["command"],
            additionalProperties: false,
          }),
        },
      },
    };
    const provider = createSandboxShellToolsProvider(() =>
      Promise.resolve({
        tools: {
          bash: {
            description: "Run commands",
            inputSchema,
          },
        },
      })
    );

    const result = await provider({
      sandbox: { executeCommand: async () => ({ stdout: "", stderr: "", exitCode: 0 }) },
      destination: "/workspace",
      promptOptions: { toolPrompt: "tools" },
    });
    const bash = result.tools.bash as { inputSchemaJson?: unknown };
    assertEquals(bash.inputSchemaJson, {
      type: "object",
      properties: { command: { type: "string" } },
      required: ["command"],
      additionalProperties: false,
    });
  });

  it("converts the pinned bash-tool schemas without a permissive fallback", async () => {
    const result = await createBashSandboxShellToolsProvider({
      sandbox: {
        executeCommand: async () => ({ stdout: "", stderr: "", exitCode: 0 }),
        readFile: async () => "",
        writeFiles: async () => undefined,
      },
      destination: "/workspace",
      promptOptions: { toolPrompt: "tools" },
    });

    const bash = result.tools.bash as {
      inputSchemaJson?: {
        type?: string;
        properties?: Record<string, unknown>;
        required?: string[];
      };
    };
    assertExists(bash.inputSchemaJson);
    assertEquals(bash.inputSchemaJson.type, "object");
    assertEquals(bash.inputSchemaJson.properties?.command, {
      type: "string",
      description: "The bash command to execute",
    });
    assertEquals(bash.inputSchemaJson.required, ["command"]);
  });

  it("rejects provider accessors instead of invoking them across the contract", async () => {
    let accessorCalls = 0;
    const definition = { description: "Run commands" };
    Object.defineProperty(definition, "inputSchema", {
      enumerable: true,
      get() {
        accessorCalls += 1;
        return {};
      },
    });
    const provider = createSandboxShellToolsProvider(() =>
      Promise.resolve({ tools: { bash: definition } })
    );

    await assertRejects(
      () =>
        provider({
          sandbox: { executeCommand: async () => ({}) },
          destination: "/workspace",
          promptOptions: { toolPrompt: "tools" },
        }),
      TypeError,
      "must be a data property",
    );
    assertEquals(accessorCalls, 0);
  });
});
