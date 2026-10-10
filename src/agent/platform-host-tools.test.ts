import { assertEquals } from "#veryfront/testing/assert.ts";
import type { HostToolSet } from "#veryfront/tool";
import {
  hasTrustedHostToolProvenance,
  markTrustedHostToolProvenance,
} from "#veryfront/tool/host-tool-provenance.ts";
import { withPlatformHostToolAliases } from "./platform-host-tools.ts";

function definition(id: string): HostToolSet[string] {
  return {
    id,
    description: id,
    inputSchemaJson: { type: "object" },
    execute: () => ({ ok: true }),
  };
}

Deno.test("trusted canonical forms retain a legacy parked-run alias without replacing project tools", () => {
  const form = markTrustedHostToolProvenance(definition("veryfront__form_input"));
  const tools = withPlatformHostToolAliases({ veryfront__form_input: form });
  assertEquals(tools.form_input?.id, "form_input");
  assertEquals(hasTrustedHostToolProvenance(tools.form_input), true);
  const project = definition("form_input");
  const collision = withPlatformHostToolAliases({ veryfront__form_input: form }, {
    form_input: project,
  });
  assertEquals(collision.form_input, project);
  assertEquals(hasTrustedHostToolProvenance(project), false);
  const untrusted = withPlatformHostToolAliases({
    veryfront__form_input: definition("veryfront__form_input"),
  });
  assertEquals(untrusted.form_input, undefined);
});
