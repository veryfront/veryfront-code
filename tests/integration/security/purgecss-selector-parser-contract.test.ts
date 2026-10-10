import { assert, assertExists } from "#veryfront/testing/assert.ts";

const root = new URL("../../../", import.meta.url);

Deno.test("the locked PurgeCSS path excludes selector-parser versions affected by GHSA-rj75-hqrm-r3gf", async () => {
  const manifest = JSON.parse(
    await Deno.readTextFile(new URL("extensions/ext-css-purgecss/deno.json", root)),
  );
  const lock = JSON.parse(await Deno.readTextFile(new URL("deno.lock", root)));
  const specifier = manifest.imports.purgecss;
  assert(
    /^npm:purgecss@\d+\.\d+\.\d+$/.test(specifier),
    "PurgeCSS must retain an exact source pin",
  );
  const version = lock.specifiers[specifier];
  assertExists(version, "PurgeCSS source pin must resolve in the frozen lock");
  const producer = lock.npm[`purgecss@${version}`];
  assertExists(producer, "PurgeCSS resolved package must be retained in the lock");
  const parsers = producer.dependencies.filter((dependency: string) =>
    dependency.startsWith("postcss-selector-parser@")
  );
  assert(parsers.length === 1, "The PurgeCSS parser dependency must resolve unambiguously");
  const parser = parsers[0];
  assertExists(lock.npm[parser], "The resolved parser must have a locked package record");
  const match = /^postcss-selector-parser@(\d+)\.(\d+)\.(\d+)$/.exec(parser);
  assertExists(
    match,
    "A prerelease or unresolved parser identity cannot establish the security floor",
  );
  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);
  assert(
    major > 7 || (major === 7 && (minor > 1 || (minor === 1 && patch >= 6))),
    `The locked PurgeCSS path uses affected ${parser}; patched minimum is 7.1.6`,
  );
});
