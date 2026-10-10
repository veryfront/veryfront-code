import { makeTempDir } from "#veryfront/testing/deno-compat.ts";
import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "#veryfront/testing/assert.ts";
import { fromFileUrl } from "#std/path";
import { vendorComponentsByWorkspaceManifest } from "../../../scripts/build/vendor-source-components.ts";
import {
  componentsForManifestBoundary,
  dependencyIndexForAllManifests,
  sbomOutputsForAllManifests,
} from "../../../scripts/build/generate-sbom.ts";

async function vendorSourceFixture() {
  const root = await makeTempDir({ prefix: "vendor-source-inventory-" });
  const member = "extensions/ext-fixture";
  await Deno.mkdir(root + "/" + member + "/vendor", { recursive: true });
  const source = "export const marker = 1;\n";
  await Deno.writeTextFile(root + "/" + member + "/vendor/memory.js", source);
  const sha256 = Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(source)),
    ),
  )
    .map((byte) => byte.toString(16).padStart(2, "0")).join("");
  const inventory = {
    components: [{
      name: "fixture-memory",
      version: "1.0.0-memory.1",
      source: "vendor/memory.js",
      sha256,
      license: "MIT",
      upstream: {
        name: "fixture",
        version: "1.0.0",
        source: "lib/index.js",
        sha256: "a".repeat(64),
        url: "https://registry.npmjs.org/fixture/-/fixture-1.0.0.tgz",
      },
    }],
  };
  const save = () =>
    Deno.writeTextFile(
      root + "/" + member + "/vendor-sources.json",
      JSON.stringify(inventory),
    );
  await save();
  return { root, member, inventory, save };
}

Deno.test("vendored source custody appears in selected, aggregate and dependency-index outputs", async () => {
  const f = await vendorSourceFixture();
  try {
    const sources = await vendorComponentsByWorkspaceManifest(
      [f.member],
      f.root,
    );
    const manifest = f.member + "/deno.json";
    const component = sources[manifest]![0]!;
    assertEquals(component.hashes, [{
      alg: "SHA-256",
      content: f.inventory.components[0]!.sha256,
    }]);
    assertEquals(component.licenses, [{ license: { id: "MIT" } }]);
    assertEquals(component.pedigree?.ancestors[0]?.name, "fixture");
    const lock = JSON.stringify({
      version: "5",
      specifiers: {},
      npm: {},
      workspace: { members: { [f.member]: { dependencies: [] } } },
    });
    const options = {
      workspaceMembers: [f.member],
      vendorComponentsByManifest: sources,
    };
    assertEquals(componentsForManifestBoundary(lock, manifest, options), [
      component,
    ]);
    const outputs = sbomOutputsForAllManifests(lock, {
      ...options,
      outputDir: "out",
    });
    assertEquals(
      outputs.find((output) => output.path === "out/all.json")?.components,
      [component],
    );
    assertEquals(
      dependencyIndexForAllManifests(lock, options).manifests.find((item) =>
        item.sourceLocation === manifest
      )?.components[0]?.purl,
      component.purl,
    );
    assertEquals(
      componentsForManifestBoundary(
        lock,
        "extensions/other/deno.json",
        options,
      ),
      [],
    );
  } finally {
    await Deno.remove(f.root, { recursive: true });
  }
});

Deno.test("vendored source inventory fails closed for altered bytes and escaping paths", async () => {
  const f = await vendorSourceFixture();
  try {
    await Deno.writeTextFile(
      f.root + "/" + f.member + "/vendor/memory.js",
      "export const marker = 2;\n",
    );
    await assertRejects(
      () => vendorComponentsByWorkspaceManifest([f.member], f.root),
      TypeError,
      "digest mismatch",
    );
    f.inventory.components[0]!.source = "../outside.js";
    await f.save();
    await assertRejects(
      () => vendorComponentsByWorkspaceManifest([f.member], f.root),
      TypeError,
      "path",
    );
    await assertRejects(
      () => vendorComponentsByWorkspaceManifest(["../outside"], f.root),
      TypeError,
      "workspace path",
    );
  } finally {
    await Deno.remove(f.root, { recursive: true });
  }
});

Deno.test("missing optional inventory is allowed; malformed present inventory cannot disappear", async () => {
  const f = await vendorSourceFixture();
  try {
    const path = f.root + "/" + f.member + "/vendor-sources.json";
    await Deno.remove(path);
    assertEquals(
      await vendorComponentsByWorkspaceManifest([f.member], f.root),
      {},
    );
    await Deno.writeTextFile(path, '{"components":[], "unexpected":true}');
    await assertRejects(
      () => vendorComponentsByWorkspaceManifest([f.member], f.root),
      TypeError,
      "fields",
    );
    await Deno.writeTextFile(path, "{");
    await assertRejects(
      () => vendorComponentsByWorkspaceManifest([f.member], f.root),
      SyntaxError,
    );
  } finally {
    await Deno.remove(f.root, { recursive: true });
  }
});

Deno.test("vendored source inventories reject dangling inventory and escaping code symlinks", async () => {
  const f = await vendorSourceFixture();
  const outside = await makeTempDir({ prefix: "vendor-source-outside-" });
  try {
    const inventoryPath = f.root + "/" + f.member + "/vendor-sources.json";
    await Deno.remove(inventoryPath);
    await Deno.symlink(f.root + "/missing-inventory.json", inventoryPath);
    await assertRejects(
      () => vendorComponentsByWorkspaceManifest([f.member], f.root),
      Deno.errors.NotFound,
    );
    await Deno.remove(inventoryPath);
    await f.save();
    const sourcePath = f.root + "/" + f.member + "/vendor/memory.js";
    await Deno.writeTextFile(
      outside + "/memory.js",
      await Deno.readTextFile(sourcePath),
    );
    await Deno.remove(sourcePath);
    await Deno.symlink(outside + "/memory.js", sourcePath);
    await assertRejects(
      () => vendorComponentsByWorkspaceManifest([f.member], f.root),
      TypeError,
      "escapes its workspace",
    );
  } finally {
    await Deno.remove(f.root, { recursive: true });
    await Deno.remove(outside, { recursive: true });
  }
});

Deno.test("different code cannot share a vendored component identity across workspace SBOMs", async () => {
  const f = await vendorSourceFixture();
  try {
    const second = "extensions/ext-second";
    await Deno.mkdir(f.root + "/" + second + "/vendor", { recursive: true });
    const changed = "export const marker = 3;\n";
    await Deno.writeTextFile(
      f.root + "/" + second + "/vendor/memory.js",
      changed,
    );
    const inventory = structuredClone(f.inventory);
    inventory.components[0]!.sha256 = Array.from(
      new Uint8Array(
        await crypto.subtle.digest(
          "SHA-256",
          new TextEncoder().encode(changed),
        ),
      ),
    )
      .map((byte) => byte.toString(16).padStart(2, "0")).join("");
    await Deno.writeTextFile(
      f.root + "/" + second + "/vendor-sources.json",
      JSON.stringify(inventory),
    );
    await assertRejects(
      () => vendorComponentsByWorkspaceManifest([f.member, second], f.root),
      TypeError,
      "Conflicting",
    );
  } finally {
    await Deno.remove(f.root, { recursive: true });
  }
});

Deno.test("lock-only artifact CLI excludes unrelated workspace source; selected source still fails closed", async () => {
  const f = await vendorSourceFixture();
  try {
    await Deno.writeTextFile(
      f.root + "/deno.json",
      JSON.stringify({
        name: "artifact-fixture",
        version: "1.0.0",
        workspace: ["./" + f.member],
      }),
    );
    await Deno.writeTextFile(
      f.root + "/selected.lock",
      JSON.stringify({
        version: "5",
        specifiers: {},
        npm: { "selected-runtime@1.2.3": { integrity: "sha512-aaa" } },
      }),
    );
    const script = fromFileUrl(
      new URL("../../../scripts/build/generate-sbom.ts", import.meta.url),
    );
    const config = fromFileUrl(
      new URL("../../../scripts/test.deno.json", import.meta.url),
    );
    const run = async (extra: string[], output: string) => {
      return await new Deno.Command(Deno.execPath(), {
        args: [
          "run",
          "--frozen",
          "--config",
          config,
          "--allow-read",
          "--allow-write",
          script,
          "--lock",
          "selected.lock",
          "--output",
          output,
          ...extra,
        ],
        cwd: f.root,
        stdout: "piped",
        stderr: "piped",
      }).output();
    };
    let result = await run([], "lock-only.json");
    assertEquals(result.code, 0, new TextDecoder().decode(result.stderr));
    const output = JSON.parse(
      await Deno.readTextFile(f.root + "/lock-only.json"),
    );
    assertEquals(
      output.components.map((component: { name: string }) => component.name),
      ["selected-runtime"],
    );
    await Deno.writeTextFile(
      f.root + "/" + f.member + "/vendor/memory.js",
      "changed",
    );
    result = await run([], "lock-only-again.json");
    assertEquals(
      result.code,
      0,
      "An unrelated source inventory cannot alter a lock-only artifact",
    );
    result = await run(
      ["--manifest", f.member + "/deno.json"],
      "selected-source.json",
    );
    assertEquals(result.code, 1);
    assertStringIncludes(
      new TextDecoder().decode(result.stderr),
      "digest mismatch",
    );
    await assertRejects(
      () => Deno.stat(f.root + "/selected-source.json"),
      Deno.errors.NotFound,
    );
  } finally {
    await Deno.remove(f.root, { recursive: true });
  }
});
