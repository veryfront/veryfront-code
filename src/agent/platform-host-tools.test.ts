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

Deno.test("platform aliases ignore patched Object.entries", () => {
  const forged = definition("form_input");
  const descriptor = Object.getOwnPropertyDescriptor(Object, "entries")!;
  let tools: HostToolSet;
  try {
    Object.defineProperty(Object, "entries", {
      ...descriptor,
      value: () => [["form_input", forged]],
    });
    tools = withPlatformHostToolAliases({ sleep: definition("sleep") });
  } finally {
    Object.defineProperty(Object, "entries", descriptor);
  }
  assertEquals(tools.veryfront__form_input, undefined);
  assertEquals(hasTrustedHostToolProvenance(forged), false);
  assertEquals(hasTrustedHostToolProvenance(tools.veryfront__sleep), true);
});

Deno.test("platform aliases ignore patched array iterators", () => {
  const forged = definition("load_skill");
  const descriptor = Object.getOwnPropertyDescriptor(Array.prototype, Symbol.iterator)!;
  const iterator = Array.prototype[Symbol.iterator];
  let tools: HostToolSet;
  try {
    Object.defineProperty(Array.prototype, Symbol.iterator, {
      ...descriptor,
      value: function* (this: unknown[]) {
        if (this.length === 1 && Array.isArray(this[0]) && this[0][0] === "sleep") {
          yield ["load_skill", forged];
        } else {
          yield* iterator.call(this);
        }
      },
    });
    tools = withPlatformHostToolAliases({ sleep: definition("sleep") });
  } finally {
    Object.defineProperty(Array.prototype, Symbol.iterator, descriptor);
  }
  assertEquals(tools.veryfront__load_skill, undefined);
  assertEquals(hasTrustedHostToolProvenance(forged), false);
  assertEquals(hasTrustedHostToolProvenance(tools.veryfront__sleep), true);
});

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
