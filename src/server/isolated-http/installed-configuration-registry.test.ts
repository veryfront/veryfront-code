import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createInstalledConfigurationRegistry } from "./installed-configuration-registry.ts";
import { snapshotRuntimeConfigurationReference } from "#veryfront/agent/runtime/runtime-configuration-reference.ts";

const reference = {
  version: 1 as const,
  projectId: "10000000-1000-4000-8000-100000000001",
  environmentId: "20000000-2000-4000-8000-200000000002",
  releaseId: "30000000-3000-4000-8000-300000000003",
  deploymentId: "40000000-4000-4000-8000-400000000004",
  configurationId: "configuration-8be713ba46cce2fad31ba40f40aec89aa5c975fa011edc4133e41a2edf0a111f",
};
const image = `ghcr.io/veryfront/source@sha256:${"a".repeat(64)}`;
function entry(ref = reference, value = "A") {
  const { projectId, environmentId, releaseId, configurationId } = ref;
  return {
    image,
    configuration: {
      projectId,
      projectSlug: "project",
      environmentId,
      environmentName: "production",
      releaseId,
      configurationId,
      variables: { SETTING: value },
    },
  };
}
describe("exact installed configuration references", () => {
  it("matches the API content digest using locale-independent key order", () => {
    // Fixed API v1 digest: Z, a, Ä use UTF-16 order, regardless of host locale or insertion order.
    const configurationId =
      "configuration-b71a921222122fd6c156e1de2a1110e386257515ee2caea98f8b746e09c02714";
    const ref = { ...reference, configurationId };
    const registry = createInstalledConfigurationRegistry([{
      ...entry(ref),
      configuration: {
        ...entry(ref).configuration,
        variables: { Ä: "accent", a: "first lowercase", Z: "last capital" },
      },
    }], { references: [ref], version: 1 });
    assertEquals(registry.select(ref).configuration.configurationId, configurationId);
  });
  it("retains same-release content versions and deduplicates deployment provenance", () => {
    const a = entry(),
      bRef = {
        ...reference,
        deploymentId: "50000000-5000-4000-8000-500000000005",
        configurationId:
          "configuration-0f57c2bb6846a391624d488ec82601eb2bcde66ad9a4f195591f67850d427da7",
      };
    const rollback = { ...reference, deploymentId: "60000000-6000-4000-8000-600000000006" };
    const references = [reference, bRef, rollback];
    const registry = createInstalledConfigurationRegistry([a, entry(bRef, "B")], {
      version: 1,
      references,
    });
    a.configuration.variables.SETTING = "mutated";
    references[0] = bRef;
    assertEquals(registry.select(reference).configuration.variables.SETTING, "A");
    assertEquals(registry.select(bRef).configuration.variables.SETTING, "B");
    assertEquals(registry.select(rollback).configuration.variables.SETTING, "A");
    assert(Object.isFrozen(registry.select(reference).reference));
    assert(Object.isFrozen(registry.select(reference).configuration.variables));
  });
  it("refuses changed immutable values or metadata under a retained ID across registry reconstruction", () => {
    const capability = { version: 1 as const, references: [reference] };
    const first = createInstalledConfigurationRegistry([entry()], capability);
    assertEquals(first.select(reference).configuration.variables.SETTING, "A");
    for (
      const changed of [entry(reference, "substituted"), {
        ...entry(),
        configuration: { ...entry().configuration, projectSlug: "substituted" },
      }, { ...entry(), configuration: { ...entry().configuration, environmentName: "staging" } }]
    ) {
      assertThrows(() => createInstalledConfigurationRegistry([changed], capability));
    }
  });
  it("refuses unknown deployment, content, source and tenant references without fallback", () => {
    const registry = createInstalledConfigurationRegistry([entry()], {
      version: 1,
      references: [reference],
    });
    for (
      const field of [
        "deploymentId",
        "projectId",
        "environmentId",
        "releaseId",
        "configurationId",
      ] as const
    ) {
      const foreign = {
        ...reference,
        [field]: field === "configurationId"
          ? `configuration-${"f".repeat(64)}`
          : "90000000-9000-4000-8000-900000000009",
      };
      assertThrows(() => registry.select(foreign));
    }
    for (
      const missing of [undefined, {}, { ...reference, version: 2 }, {
        ...reference,
        state: "pending",
      }]
    ) {
      assertThrows(() => registry.select(missing));
    }
  });
  it("refuses content replacement, ambiguous source images and incomplete explicit profiles", () => {
    assertThrows(() =>
      createInstalledConfigurationRegistry([entry(), entry(reference, "B")], {
        version: 1,
        references: [reference],
      })
    );
    const bRef = {
      ...reference,
      configurationId:
        "configuration-0f57c2bb6846a391624d488ec82601eb2bcde66ad9a4f195591f67850d427da7",
    };
    assertThrows(() =>
      createInstalledConfigurationRegistry([entry(), {
        ...entry(bRef),
        image: image.replace("a".repeat(64), "b".repeat(64)),
      }], { version: 1, references: [reference, bRef] })
    );
    assertThrows(() =>
      createInstalledConfigurationRegistry([entry()], { version: 1, references: [] })
    );
    assertThrows(() =>
      createInstalledConfigurationRegistry([entry(), entry(bRef)], {
        version: 1,
        references: [reference],
      })
    );
  });
  it("does not invoke reference accessors or inherit prototype authority", () => {
    let calls = 0;
    assertThrows(() =>
      snapshotRuntimeConfigurationReference({
        ...reference,
        get configurationId() {
          calls++;
          return reference.configurationId;
        },
      })
    );
    assertEquals(calls, 0);
    assertThrows(() => snapshotRuntimeConfigurationReference(Object.create(reference)));
  });
});
