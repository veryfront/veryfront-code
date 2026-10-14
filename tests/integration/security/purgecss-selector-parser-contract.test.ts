import {
  assert,
  assertEquals,
  assertExists,
} from "#veryfront/testing/assert.ts";

const root = new URL("../../../", import.meta.url);

Deno.test("the PurgeCSS provider pins a selector parser above the advisory floor", async () => {
  const manifest = JSON.parse(
    await Deno.readTextFile(
      new URL("extensions/ext-css-purgecss/deno.json", root),
    ),
  );
  const lock = JSON.parse(await Deno.readTextFile(new URL("deno.lock", root)));
  const specifier = manifest.imports["postcss-selector-parser"];
  assert(
    /^npm:postcss-selector-parser@\d+\.\d+\.\d+$/.test(specifier),
    "The runtime parser must have an exact source pin",
  );
  const version = lock.specifiers[specifier];
  assertExists(version, "The runtime parser must resolve in the frozen lock");
  assertExists(lock.npm[`postcss-selector-parser@${version}`]);
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  assertExists(
    match,
    "A prerelease or unresolved identity cannot establish the security floor",
  );
  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);
  assert(
    major > 7 || (major === 7 && (minor > 1 || (minor === 1 && patch >= 6))),
    `The runtime parser uses affected ${version}; patched minimum is 7.1.6`,
  );
  assertEquals(manifest.imports.purgecss, "./vendor/purgecss-memory.js");
});

Deno.test("the in-memory PurgeCSS distribution retains source custody and only parser dependencies", async () => {
  const base = new URL("extensions/ext-css-purgecss/", root);
  const inventory = JSON.parse(
    await Deno.readTextFile(new URL("vendor-sources.json", base)),
  );
  assertEquals(inventory.components.length, 1);
  const component = inventory.components[0];
  assertEquals(component.name, "purgecss-in-memory");
  assertEquals(component.upstream.name, "purgecss");
  assertEquals(component.upstream.version, "8.0.0");
  const recipe = JSON.parse(
    await Deno.readTextFile(
      new URL("scripts/build/purgecss-memory-edits.json", root),
    ),
  );
  assertEquals(component.upstream.version, recipe.version);
  assertEquals(component.upstream.sha256, recipe.upstreamSHA256);
  assertEquals(component.upstream.source, "lib/purgecss.esm.js");
  assertEquals(
    component.upstream.url,
    "https://registry.npmjs.org/purgecss/-/purgecss-8.0.0.tgz",
  );
  assertEquals(component.license, "MIT");
  assertEquals(component.source, "vendor/purgecss-memory.js");
  const bytes = await Deno.readFile(new URL(component.source, base));
  const digest = Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
  )
    .map((byte) => byte.toString(16).padStart(2, "0")).join("");
  assertEquals(
    digest,
    component.sha256,
    "Bundled code must match the reviewed source inventory",
  );
  const source = new TextDecoder().decode(bytes);
  const imports = Array.from(
    source.matchAll(/^import .*? from ['"]([^'"]+)['"];$/gm),
    (match) => match[1],
  );
  assertEquals(imports, ["postcss", "postcss-selector-parser"]);
  assert(
    source.includes("Permission is hereby granted"),
    "Retain the upstream license in bundled source",
  );
});

Deno.test("the CSS algorithm reconstructs the pinned upstream source and rejects tampering", async () => {
  const { preparePurgeCSSMemorySource, reconstructPurgeCSSUpstream } =
    await import(
      "../../../scripts/build/prepare-purgecss-memory-source.ts"
    );
  const base = new URL("extensions/ext-css-purgecss/vendor/", root);
  const source = await Deno.readTextFile(new URL("purgecss-memory.js", base));
  const license = await Deno.readTextFile(new URL("LICENSE", base));
  const upstream = await reconstructPurgeCSSUpstream(source, license);
  assertEquals(await preparePurgeCSSMemorySource(upstream, license), source);
  let rejected = false;
  try {
    await reconstructPurgeCSSUpstream(
      source.replace(
        'const IGNORE_ANNOTATION_CURRENT = "purgecss ignore current";',
        'const IGNORE_ANNOTATION_CURRENT = "changed";',
      ),
      license,
    );
  } catch (error) {
    rejected = error instanceof TypeError;
  }
  assert(
    rejected,
    "Changing the CSS algorithm must fail pinned upstream custody",
  );
});

Deno.test("all shipped selector parsers meet the security floor, including Typography", async () => {
  const manifest = JSON.parse(
    await Deno.readTextFile(
      new URL("extensions/ext-css-tailwind/deno.json", root),
    ),
  );
  assertEquals(
    manifest.imports["postcss-selector-parser"],
    "npm:postcss-selector-parser@7.1.6",
  );
  assertEquals(
    manifest.imports["@tailwindcss/typography"],
    "./vendor/typography.js",
  );
  const lock = JSON.parse(await Deno.readTextFile(new URL("deno.lock", root)));
  for (const key of Object.keys(lock.npm)) {
    if (!key.startsWith("postcss-selector-parser@")) continue;
    const version = key.slice("postcss-selector-parser@".length);
    const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
    assertExists(match);
    const major = Number(match[1]);
    const minor = Number(match[2]);
    const patch = Number(match[3]);
    assert(
      major > 7 || (major === 7 && (minor > 1 || (minor === 1 && patch >= 6))),
      key,
    );
  }
});

Deno.test("Typography retains all original module digests, license and patched parser binding", async () => {
  const base = new URL("extensions/ext-css-tailwind/", root);
  const inventory = JSON.parse(
    await Deno.readTextFile(new URL("vendor-sources.json", base)),
  );
  const component = inventory.components[0];
  const source = await Deno.readTextFile(new URL(component.source, base));
  const actualSHA = Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(source)),
    ),
  )
    .map((byte) => byte.toString(16).padStart(2, "0")).join("");
  assertEquals(actualSHA, component.sha256);
  assertEquals(component.upstream.name, "@tailwindcss/typography");
  assertEquals(component.upstream.version, "0.5.19");
  const manifest = JSON.parse(
    await Deno.readTextFile(new URL("deno.json", base)),
  );
  assertEquals(
    manifest.imports["tailwindcss/plugin"],
    "npm:tailwindcss@4.2.2/plugin",
  );
  assertEquals(
    manifest.imports["tailwindcss/colors"],
    "npm:tailwindcss@4.2.2/colors",
  );
  assertEquals(
    manifest.imports["postcss-selector-parser"],
    "npm:postcss-selector-parser@7.1.6",
  );
  assertEquals(
    Array.from(
      source.matchAll(/^import .* from "([^"]+)";$/gm),
      (match) => match[1],
    ),
    [
      "tailwindcss/plugin",
      "tailwindcss/colors",
      "postcss-selector-parser",
    ],
  );
  const license = await Deno.readTextFile(new URL("vendor/LICENSE", base));
  const { reconstructTypographyUpstream, prepareTypographySource } =
    await import(
      "../../../scripts/build/prepare-typography-source.ts"
    );
  const original = await reconstructTypographyUpstream(source, license);
  assertEquals(Object.keys(original), ["utils.js", "styles.js", "index.js"]);
  const upstreamSHA = Array.from(
    new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(original["index.js"]),
      ),
    ),
  )
    .map((byte) => byte.toString(16).padStart(2, "0")).join("");
  assertEquals(component.upstream.sha256, upstreamSHA);
  assertEquals(component.upstream.source, "src/index.js");
  assertEquals(
    component.upstream.url,
    "https://registry.npmjs.org/@tailwindcss/typography/-/typography-0.5.19.tgz",
  );
  assertEquals(await prepareTypographySource(original, license), source);
  for (
    const corrupt of [
      source.replace("const defaultModifiers", "let defaultModifiers"),
      source + "\n",
    ]
  ) {
    let failed = false;
    try {
      await reconstructTypographyUpstream(corrupt, license);
    } catch {
      failed = true;
    }
    assert(failed, "Unreviewed Typography source must fail custody checks");
  }
});
