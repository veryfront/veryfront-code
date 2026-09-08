import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { defineSchema } from "#veryfront/schemas/index.ts";
import { createToolsFromHostDefinitions } from "#veryfront/tool/host-tools.ts";
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
      Object.values = (value) => {
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
