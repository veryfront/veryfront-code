import "#veryfront/schemas/_test-setup.ts";
/**
 * Factory loader tests — dynamic import, default export handling, error paths.
 *
 * @module extensions/factory-loader.test
 */

import { assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { VeryfrontError } from "#veryfront/errors/types.ts";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import { toFileUrl } from "#veryfront/compat/path";
import { join } from "@std/path";
import { bindExtensionEntrypoint, captureExtensionOwner } from "./entrypoint-identity.ts";
import { assertCanonicalExtensionImport, loadExtensionFactory } from "./factory-loader.ts";

describe("loadExtensionFactory()", () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await Deno.makeTempDir({ prefix: "vf-factory-loader-" });
  });

  afterEach(async () => {
    await Deno.remove(tmp, { recursive: true });
  });

  it("loads an extension from a factory with a default export", async () => {
    const path = join(tmp, "ok.extension.ts");
    await Deno.writeTextFile(
      path,
      `export default () => ({
        name: "ok-ext",
        version: "1.2.3",
        capabilities: [{ type: "bundler" }],
      });`,
    );

    const resolved = await loadExtensionFactory(path, "local-file");
    assertEquals(resolved.extension.name, "ok-ext");
    assertEquals(resolved.extension.version, "1.2.3");
    assertEquals(resolved.source, "local-file");
    assertEquals(resolved.origin, path);
    assertEquals(resolved.extension.capabilities[0]?.type, "bundler");
  });

  it("forwards config to the factory", async () => {
    const path = join(tmp, "config.extension.ts");
    await Deno.writeTextFile(
      path,
      `export default (config) => ({
        name: "cfg-ext",
        version: "1.0.0",
        capabilities: [],
        provides: { CfgEcho: config },
      });`,
    );

    const resolved = await loadExtensionFactory(path, "config", {
      hello: "world",
    });
    assertEquals(
      (resolved.extension.provides as { CfgEcho: unknown }).CfgEcho,
      { hello: "world" },
    );
  });

  it("throws EXTENSION_VALIDATION_ERROR when default export is missing", async () => {
    const path = join(tmp, "no-default.extension.ts");
    await Deno.writeTextFile(
      path,
      `export const named = () => ({ name: "x", version: "1.0.0", capabilities: [] });`,
    );

    const error = await assertRejects(
      () => loadExtensionFactory(path, "local-file"),
      VeryfrontError,
      "no default export",
    ) as VeryfrontError;
    assertEquals(
      error.slug,
      "extension-validation",
      "factory-loader failures must carry the registry slug",
    );
    assertEquals(
      error.status,
      422,
      "factory-loader failures must carry the registry status",
    );
    assertEquals(
      error.category,
      "CONFIG",
      "factory-loader failures must carry the registry category",
    );
  });

  it("throws EXTENSION_VALIDATION_ERROR when default export is not a function", async () => {
    const path = join(tmp, "not-fn.extension.ts");
    await Deno.writeTextFile(
      path,
      `export default { name: "not-fn", version: "1.0.0", capabilities: [] };`,
    );

    const error = await assertRejects(
      () => loadExtensionFactory(path, "local-file"),
      VeryfrontError,
      "default export is not a function",
    ) as VeryfrontError;
    assertEquals(
      error.slug,
      "extension-validation",
      "factory-loader failures must carry the registry slug",
    );
    assertEquals(
      error.status,
      422,
      "factory-loader failures must carry the registry status",
    );
    assertEquals(
      error.category,
      "CONFIG",
      "factory-loader failures must carry the registry category",
    );
  });

  it("throws EXTENSION_VALIDATION_ERROR when factory throws", async () => {
    const path = join(tmp, "throws.extension.ts");
    await Deno.writeTextFile(
      path,
      `export default () => { throw new Error("boom"); };`,
    );

    const error = await assertRejects(
      () => loadExtensionFactory(path, "local-file"),
      VeryfrontError,
      "boom",
    ) as VeryfrontError;
    assertEquals(
      error.slug,
      "extension-validation",
      "factory-loader failures must carry the registry slug",
    );
    assertEquals(
      error.status,
      422,
      "factory-loader failures must carry the registry status",
    );
    assertEquals(
      error.category,
      "CONFIG",
      "factory-loader failures must carry the registry category",
    );
  });

  it("throws EXTENSION_VALIDATION_ERROR when import fails (missing file)", async () => {
    const path = join(tmp, "does-not-exist.extension.ts");

    const error = await assertRejects(
      () => loadExtensionFactory(path, "local-file"),
      VeryfrontError,
      "Failed to import extension",
    ) as VeryfrontError;
    assertEquals(
      error.slug,
      "extension-validation",
      "factory-loader failures must carry the registry slug",
    );
    assertEquals(
      error.status,
      422,
      "factory-loader failures must carry the registry status",
    );
    assertEquals(
      error.category,
      "CONFIG",
      "factory-loader failures must carry the registry category",
    );
  });

  it("preserves the discovered source on the returned ResolvedExtension", async () => {
    const path = join(tmp, "pkg.extension.ts");
    await Deno.writeTextFile(
      path,
      `export default () => ({ name: "pkg-ext", version: "1.0.0", capabilities: [] });`,
    );

    const resolved = await loadExtensionFactory(path, "package");
    assertEquals(resolved.source, "package");
  });

  it("does not call DNT's incompatible import.meta.resolve ponyfill on Node", () => {
    let resolverCalls = 0;
    assertCanonicalExtensionImport(
      "file:///project/extension.ts",
      "/project/extension.ts",
      {
        runtime: "node",
        resolver: () => {
          resolverCalls++;
          throw new Error("require.resolve cannot load file URLs");
        },
      },
    );
    assertEquals(resolverCalls, 0);
  });

  it("fails closed without a resolver outside Node", () => {
    assertThrows(
      () =>
        assertCanonicalExtensionImport(
          "file:///project/extension.ts",
          "/project/extension.ts",
          { runtime: "other" },
        ),
      Error,
      "cannot verify extension import target",
    );
  });

  it("rejects a discovered target replaced before import", async () => {
    const ownerPath = join(tmp, "bound-extension");
    const targetPath = join(ownerPath, "index.ts");
    await Deno.mkdir(ownerPath, { recursive: true });
    await Deno.writeTextFile(
      targetPath,
      'export default () => ({ name: "first", version: "1", capabilities: [] });',
    );
    const owner = await captureExtensionOwner(ownerPath);
    const binding = await bindExtensionEntrypoint(owner, "./index.ts");

    await Deno.rename(targetPath, join(ownerPath, "first.ts"));
    await Deno.writeTextFile(
      targetPath,
      'export default () => ({ name: "replacement", version: "1", capabilities: [] });',
    );

    await assertRejects(
      () => loadExtensionFactory(binding.path, "project", undefined, binding),
      Error,
      "target identity changed",
    );
  });

  it("rejects a binding captured for a different entrypoint than the import target", async () => {
    const boundOwnerPath = join(tmp, "bound-owner");
    const otherOwnerPath = join(tmp, "other-owner");
    const otherPath = join(otherOwnerPath, "index.ts");
    await Deno.mkdir(boundOwnerPath, { recursive: true });
    await Deno.mkdir(otherOwnerPath, { recursive: true });
    await Deno.writeTextFile(
      join(boundOwnerPath, "index.ts"),
      'export default () => ({ name: "bound", version: "1", capabilities: [] });',
    );
    // Importing this module throws at module scope, so the rejection message
    // doubles as proof that the guard refused before any import happened.
    await Deno.writeTextFile(
      otherPath,
      'throw new Error("other module must not be imported");',
    );
    const binding = await bindExtensionEntrypoint(
      await captureExtensionOwner(boundOwnerPath),
      "./index.ts",
    );

    await assertRejects(
      () => loadExtensionFactory(otherPath, "project", undefined, binding),
      Error,
      "Extension discovery binding does not match import target",
    );
  });

  for (const mappingKind of ["exact", "prefix"] as const) {
    it(`rejects ${mappingKind} import-map redirection of an unbound local file URL`, async () => {
      const targetDirectory = join(tmp, "authorized");
      const redirectDirectory = join(tmp, "redirected");
      const targetPath = join(targetDirectory, "index.ts");
      const redirectedPath = join(redirectDirectory, "index.ts");
      const configPath = join(tmp, `${mappingKind}.deno.json`);
      const childPath = join(tmp, `${mappingKind}.child.ts`);
      await Deno.mkdir(targetDirectory, { recursive: true });
      await Deno.mkdir(redirectDirectory, { recursive: true });
      await Deno.writeTextFile(
        targetPath,
        'export default () => ({ name: "authorized", version: "1", capabilities: [] });',
      );
      await Deno.writeTextFile(
        redirectedPath,
        'export default () => ({ name: "redirected", version: "1", capabilities: [] });',
      );

      const repositoryRoot = Deno.cwd();
      const targetUrl = toFileUrl(targetPath).href;
      const mappings: Record<string, string> = {
        "#veryfront/compat/path": toFileUrl(
          join(repositoryRoot, "src", "platform", "compat", "path", "index.ts"),
        ).href,
        "#veryfront/compat/": `${
          toFileUrl(join(repositoryRoot, "src", "platform", "compat")).href
        }/`,
        "#veryfront/errors/": `${toFileUrl(join(repositoryRoot, "src", "errors")).href}/`,
        "#veryfront/platform/": `${toFileUrl(join(repositoryRoot, "src", "platform")).href}/`,
        "#veryfront/": `${toFileUrl(join(repositoryRoot, "src")).href}/`,
      };
      if (mappingKind === "exact") {
        mappings[targetUrl] =
          "data:text/javascript,export default () => ({ name: 'redirected', version: '1', capabilities: [] })";
      } else {
        mappings[`${toFileUrl(targetDirectory).href}/`] = `${toFileUrl(redirectDirectory).href}/`;
      }
      await Deno.writeTextFile(configPath, JSON.stringify({ imports: mappings }));

      const loaderUrl = new URL("./factory-loader.ts", import.meta.url).href;
      await Deno.writeTextFile(
        childPath,
        `import { loadExtensionFactory } from ${JSON.stringify(loaderUrl)};
try {
  await loadExtensionFactory(${JSON.stringify(targetPath)}, "local-file");
  Deno.exit(2);
} catch (error) {
  const detail = error && typeof error === "object" && "detail" in error
    ? String(error.detail)
    : String(error);
  if (!detail.includes("remapped")) {
    console.error(detail);
    Deno.exit(3);
  }
  console.log("rejected-remap");
}`,
      );

      const output = await new Deno.Command(Deno.execPath(), {
        args: ["run", "--config", configPath, "--allow-read", childPath],
        stdout: "piped",
        stderr: "piped",
      }).output();
      assertEquals(
        output.success,
        true,
        new TextDecoder().decode(output.stderr),
      );
      assertEquals(new TextDecoder().decode(output.stdout).trim(), "rejected-remap");
    });
  }
});
