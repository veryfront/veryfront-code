import "#veryfront/schemas/_test-setup.ts";
/**
 * Tests for `veryfront generate adapter <engine>` — vendoring a veryfront/ui
 * engine adapter template into a consumer project.
 */
import { assert, assertRejects, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { join } from "#std/path.ts";
import { generateUiAdapter } from "./adapter-generator.ts";
import { getUiAdapterTemplate, listUiAdapters } from "../../templates/loader.ts";

describe("commands/generate/adapter-generator", () => {
  it("the manifest ships the four engine templates", () => {
    const engines = listUiAdapters();
    for (const engine of ["base-ui", "radix", "react-aria", "ariakit"]) {
      assert(engines.includes(engine), `manifest missing ui-adapter:${engine}`);
    }
  });

  it("base-ui template maps the overlay archetypes + exports its adapter", () => {
    const files = getUiAdapterTemplate("base-ui");
    assert(files && files.length === 1, "base-ui template should be one file");
    const src = files![0]!.content;
    for (const slot of ["popover:", "dialog:", "menu:", "tooltip:"]) {
      assertStringIncludes(src, slot);
    }
    assertStringIncludes(src, "baseUiAdapter");
  });

  it("vendors ui-adapters/<engine>.tsx into the project", async () => {
    const dir = await Deno.makeTempDir();
    try {
      await generateUiAdapter(dir, "radix");
      const dest = join(dir, "ui-adapters", "radix.tsx");
      const written = await Deno.readTextFile(dest);
      assertStringIncludes(written, "radixAdapter");
      assertStringIncludes(written, "REFERENCE TEMPLATE");
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  });

  it("does not clobber an already-vendored adapter", async () => {
    const dir = await Deno.makeTempDir();
    try {
      await Deno.mkdir(join(dir, "ui-adapters"));
      const dest = join(dir, "ui-adapters", "base-ui.tsx");
      await Deno.writeTextFile(dest, "// my edited adapter\n");
      await generateUiAdapter(dir, "base-ui");
      const after = await Deno.readTextFile(dest);
      assert(after === "// my edited adapter\n", "must not overwrite a vendored file");
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  });

  it("rejects an unknown engine with the available list", async () => {
    const dir = await Deno.makeTempDir();
    try {
      await assertRejects(
        () => generateUiAdapter(dir, "not-an-engine"),
        Error,
        "Unknown ui adapter engine",
      );
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  });
});
