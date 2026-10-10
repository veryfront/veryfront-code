import { assertEquals } from "#veryfront/testing/assert.ts";
import type { HostToolSet } from "#veryfront/tool";
import {
  hasTrustedHostToolProvenance,
  markTrustedHostToolProvenance,
} from "#veryfront/tool/host-tool-provenance.ts";
import {
  retainTrustedSkillLoaderAliases,
  withPlatformHostToolAliases,
} from "./platform-host-tools.ts";

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

for (
  const names of [
    { selected: "load_skill", sibling: "veryfront__load_skill" },
    { selected: "veryfront__load_skill", sibling: "load_skill" },
  ]
) {
  Deno.test(`trusted loader sibling uses only the selected implementation (${names.selected})`, async () => {
    const executed: string[] = [];
    const selected = markTrustedHostToolProvenance({
      ...definition(names.selected),
      execute: () => {
        executed.push(names.selected);
        return { selected: names.selected };
      },
    });
    const sibling = markTrustedHostToolProvenance({
      ...definition(names.sibling),
      execute: () => {
        throw new Error("Unselected operation must not execute");
      },
    });
    const originalTools = { [names.selected]: selected, [names.sibling]: sibling };
    const selectedTools = { [names.selected]: selected };
    const tools = retainTrustedSkillLoaderAliases({ tools: selectedTools, originalTools });
    assertEquals(tools[names.selected], selected);
    assertEquals(tools[names.sibling]?.id, names.sibling);
    assertEquals(hasTrustedHostToolProvenance(tools[names.sibling]), true);
    assertEquals(await tools[names.sibling]?.execute?.({}), { selected: names.selected });
    assertEquals(executed, [names.selected]);
    assertEquals(originalTools[names.sibling], sibling);
    assertEquals(Object.hasOwn(selectedTools, names.sibling), false);
  });
}

Deno.test("trusted loader retention preserves exact denials and project collisions", () => {
  const selected = markTrustedHostToolProvenance(definition("veryfront__load_skill"));
  const sibling = markTrustedHostToolProvenance(definition("load_skill"));
  const tools = { veryfront__load_skill: selected };
  const originalTools = { veryfront__load_skill: selected, load_skill: sibling };
  for (const denied of ["load_skill", "veryfront__load_skill"]) {
    assertEquals(
      retainTrustedSkillLoaderAliases({ tools, originalTools, deniedToolNames: [denied] }),
      tools,
    );
  }
  assertEquals(retainTrustedSkillLoaderAliases({ tools: {}, originalTools }), {});
  assertEquals(retainTrustedSkillLoaderAliases({ tools, originalTools: tools }), tools);
  assertEquals(
    retainTrustedSkillLoaderAliases({
      tools,
      originalTools: { ...originalTools, load_skill: definition("load_skill") },
    }),
    tools,
  );
  const projectSelected = { veryfront__load_skill: definition("veryfront__load_skill") };
  assertEquals(
    retainTrustedSkillLoaderAliases({ tools: projectSelected, originalTools }),
    projectSelected,
  );
  Object.defineProperty(originalTools, "load_skill", {
    get: () => {
      throw new Error("Accessor must not run");
    },
  });
  assertEquals(retainTrustedSkillLoaderAliases({ tools, originalTools }), tools);
});
