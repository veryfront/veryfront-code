import { isToolAllowedBySourcePolicy } from "./platform-tool-policy.ts";
import { markTrustedPlatformSource } from "./platform-source-provenance.ts";
import type { SourceIntegrationPolicyManifest } from "#veryfront/integrations/source-policy.ts";
import type { RemoteToolSource } from "./types.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";

const policies: SourceIntegrationPolicyManifest[] = [
  { schemaVersion: 1, mode: "unrestricted" },
  { schemaVersion: 1, mode: "allowlist", integrations: { veryfront: { allowedToolIds: null } } },
  { schemaVersion: 1, mode: "allowlist", integrations: {} },
];

function source(): RemoteToolSource {
  return {
    id: "platform",
    listTools: () => Promise.resolve([]),
    executeTool: () => Promise.resolve({}),
  };
}

describe("isToolAllowedBySourcePolicy", () => {
  for (
    const name of ["veryfront__export_data", "veryfront__export__data", "veryfront__ExportData"]
  ) {
    it(`requires trusted provenance for reserved name ${name}`, () => {
      for (const policy of policies) {
        assertEquals(isToolAllowedBySourcePolicy(name, policy), false);
        assertEquals(isToolAllowedBySourcePolicy(name, policy, source()), false);
        assertEquals(
          isToolAllowedBySourcePolicy(name, policy, markTrustedPlatformSource(source())),
          true,
        );
      }
    });
  }

  it("applies the integration policy to other names", () => {
    const [unrestricted, , denyAll] = policies;
    assertEquals(isToolAllowedBySourcePolicy("gmail__send", unrestricted!), true);
    assertEquals(isToolAllowedBySourcePolicy("gmail__send", denyAll!), false);
    assertEquals(isToolAllowedBySourcePolicy("local_tool", denyAll!), true);
  });
});
