import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { defineSchema } from "#veryfront/schemas/index.ts";
import { createToolsFromHostDefinitions } from "#veryfront/tool/host-tools.ts";
import { prepareFacadedHostedChatRuntimeToolAssembly } from "#veryfront/agent/hosted/chat-runtime-tool-assembly.ts";
import {
  hasTrustedHostToolProvenance,
  inheritTrustedHostToolProvenance,
  markTrustedHostToolProvenance,
  markTrustedHostToolSet,
} from "#veryfront/tool/host-tool-provenance.ts";
import {
  isRuntimeLocalTool,
  markRuntimeLocalTool,
  markSkillDelegationOverridesUnsupported,
  supportsSkillDelegationOverrides,
} from "#veryfront/agent/runtime/local-tool.ts";
import {
  getRemoteToolProvenance,
  markRemoteToolProvenance,
} from "#veryfront/tool/remote-tool-provenance.ts";

describe("runtime tool provenance intrinsics", () => {
  for (const kind of ["typed", "dynamic"] as const) {
    it(`keeps ${kind} factory configs out of inherited optional-field getters`, () => {
      const definition = {
        description: "Synthetic private tool",
        inputSchema: defineSchema((v) => v.object({}))(),
        ...(kind === "dynamic" ? { inputSchemaJson: { type: "object" as const } } : {}),
        execute: () => ({ ok: true }),
      };
      const fields = [
        "outputSchema",
        "toModelOutput",
        "allowUnknownSchema",
        "delegatedIntegrationTools",
      ];
      const originals = fields.map((field) =>
        Object.getOwnPropertyDescriptor(Object.prototype, field)
      );
      const defineProperty = Object.defineProperty;
      const ownDescriptor = Object.getOwnPropertyDescriptor;
      let exposures = 0;
      let materialized = false;
      try {
        for (const field of fields) {
          defineProperty(Object.prototype, field, {
            configurable: true,
            get() {
              if (typeof ownDescriptor(this, "execute")?.value === "function") exposures++;
              return undefined;
            },
            set(value: unknown) {
              defineProperty(this, field, {
                value,
                enumerable: true,
                configurable: true,
                writable: true,
              });
            },
          });
        }
        materialized =
          createToolsFromHostDefinitions({ private: definition }).private !== undefined;
      } finally {
        for (let index = 0; index < fields.length; index++) {
          const field = fields[index]!;
          const original = originals[index];
          if (original) defineProperty(Object.prototype, field, original);
          else delete (Object.prototype as Record<string, unknown>)[field];
        }
      }
      assertEquals(materialized, true);
      assertEquals(exposures, 0);
    });
  }

  it("keeps fallback facade entries private from inherited array setters", async () => {
    const definition = {
      description: "Synthetic fetch tool",
      inputSchema: defineSchema((v) => v.object({}))(),
      execute: () => ({ ok: true }),
    };
    const original = Object.getOwnPropertyDescriptor(Array.prototype, "0");
    const defineProperty = Object.defineProperty;
    let exposures = 0;
    let names: string[] | undefined;
    try {
      defineProperty(Array.prototype, "0", {
        configurable: true,
        set(value: unknown) {
          if (Array.isArray(value) && value[1] === definition) exposures++;
          defineProperty(this, "0", {
            value,
            enumerable: true,
            configurable: true,
            writable: true,
          });
        },
      });
      const assembly = await prepareFacadedHostedChatRuntimeToolAssembly({
        signal: new AbortController().signal,
        taskContext: { projectId: "synthetic-project", model: "openai/gpt-5.4-nano" },
        instructions: "Synthetic instructions",
        sourceIntegrationPolicy: { schemaVersion: 1, mode: "unrestricted" },
        localTools: { web_fetch: definition },
        allowedToolNames: [],
        allowedProviderToolNames: ["web_fetch"],
        remoteToolSources: [],
      });
      names = assembly.localToolNames;
    } finally {
      if (original) defineProperty(Array.prototype, "0", original);
      else delete (Array.prototype as unknown as Record<string, unknown>)["0"];
    }
    assertEquals(names, ["web_fetch"]);
    assertEquals(exposures, 0);
  });

  it("materializes private definitions without invoking inherited metadata getters", () => {
    const definition = {
      description: "Synthetic private tool",
      inputSchema: defineSchema((v) => v.object({}))(),
      execute: () => ({ ok: true }),
    };
    const fields = ["inputSchemaJson", "mcp"];
    const originals = fields.map((field) =>
      Object.getOwnPropertyDescriptor(Object.prototype, field)
    );
    const defineProperty = Object.defineProperty;
    let exposures = 0;
    let materialized = false;
    try {
      for (const field of fields) {
        defineProperty(Object.prototype, field, {
          configurable: true,
          get() {
            if (this === definition) exposures++;
            return undefined;
          },
          set(value: unknown) {
            defineProperty(this, field, {
              value,
              enumerable: true,
              configurable: true,
              writable: true,
            });
          },
        });
      }
      materialized = createToolsFromHostDefinitions({ private: definition }).private !== undefined;
    } finally {
      for (let index = 0; index < fields.length; index++) {
        const field = fields[index]!;
        const original = originals[index];
        if (original) defineProperty(Object.prototype, field, original);
        else delete (Object.prototype as Record<string, unknown>)[field];
      }
    }
    assertEquals(materialized, true);
    assertEquals(exposures, 0);
  });

  it("keeps trusted tools private when weak collection methods and object enumeration are replaced", () => {
    const source = markTrustedHostToolProvenance({ execute: () => ({ ok: true }) });
    const target = { execute: source.execute };
    const tools = { source };
    const originalHas = WeakSet.prototype.has;
    const originalAdd = WeakSet.prototype.add;
    const originalGet = WeakMap.prototype.get;
    const originalSet = WeakMap.prototype.set;
    const originalValues = Object.values;
    let exposures = 0;
    try {
      WeakSet.prototype.has = function (value) {
        if (value === source || value === target) exposures++;
        return originalHas.call(this, value);
      };
      WeakSet.prototype.add = function (value) {
        if (value === source || value === target) exposures++;
        return originalAdd.call(this, value);
      };
      WeakMap.prototype.get = function (key) {
        if (key === source || key === target) exposures++;
        return originalGet.call(this, key);
      };
      WeakMap.prototype.set = function (key, value) {
        if (key === source || key === target) exposures++;
        return originalSet.call(this, key, value);
      };
      Object.values = (value: Parameters<typeof originalValues>[0]) => {
        if (value === tools) exposures++;
        return originalValues(value);
      };
      markTrustedHostToolSet(tools);
      inheritTrustedHostToolProvenance(source, target);
    } finally {
      WeakSet.prototype.has = originalHas;
      WeakSet.prototype.add = originalAdd;
      WeakMap.prototype.get = originalGet;
      WeakMap.prototype.set = originalSet;
      Object.values = originalValues;
    }
    assertEquals(exposures, 0);
    assertEquals(hasTrustedHostToolProvenance(target), true);
    assertEquals(hasTrustedHostToolProvenance({}), false);
  });

  it("marks runtime and remote tools without exposing them to a replaced property intrinsic", () => {
    const tools = createToolsFromHostDefinitions({
      private: {
        description: "Synthetic private tool",
        inputSchema: defineSchema((v) => v.object({}))(),
        execute: () => ({ ok: true }),
      },
    });
    const tool = tools.private;
    assert(tool);
    const original = Object.defineProperty;
    let exposures = 0;
    try {
      Object.defineProperty = (value, key, descriptor) => {
        if (value === tool) exposures++;
        return original(value, key, descriptor);
      };
      markRuntimeLocalTool(tool);
      markSkillDelegationOverridesUnsupported(tool);
      markRemoteToolProvenance(tool, "synthetic_remote");
    } finally {
      Object.defineProperty = original;
    }
    assertEquals(exposures, 0);
    assertEquals(isRuntimeLocalTool(tool), true);
    assertEquals(supportsSkillDelegationOverrides(tool), false);
    assertEquals(getRemoteToolProvenance(tool), "synthetic_remote");
  });
});
