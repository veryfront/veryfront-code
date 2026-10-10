/** Reproduce the reviewed in-memory distribution; never fetch or execute upstream code. */
import recipe from "./purgecss-memory-edits.json" with { type: "json" };

async function digest(text: string): Promise<string> {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)),
    ),
  )
    .map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function header(license: string): string {
  return "/*!\n" + license +
    "*/\n\n// PurgeCSS8 in-memory distribution; see ../vendor-sources.json and README.md.\n";
}

function edits(source: string, reverse: boolean): string {
  const changes = reverse ? recipe.edits.toReversed() : recipe.edits;
  for (const change of changes) {
    const before = reverse ? change.after : change.before;
    const after = reverse ? change.before : change.after;
    const index = source.indexOf(before);
    if (!before || index < 0 || index !== source.lastIndexOf(before)) {
      throw new TypeError("PurgeCSS source edit is missing or ambiguous");
    }
    source = source.slice(0, index) + after +
      source.slice(index + before.length);
  }
  return source;
}

export async function preparePurgeCSSMemorySource(
  upstream: string,
  license: string,
): Promise<string> {
  if (
    await digest(upstream) !== recipe.upstreamSHA256 ||
    await digest(license) !== recipe.licenseSHA256
  ) {
    throw new TypeError("PurgeCSS upstream source or license digest mismatch");
  }
  return header(license) + edits(upstream, false);
}

export async function reconstructPurgeCSSUpstream(
  bundled: string,
  license: string,
): Promise<string> {
  if (
    await digest(license) !== recipe.licenseSHA256 ||
    !bundled.startsWith(header(license))
  ) {
    throw new TypeError(
      "PurgeCSS source attribution does not match the reviewed distribution",
    );
  }
  const upstream = edits(bundled.slice(header(license).length), true);
  if (await digest(upstream) !== recipe.upstreamSHA256) {
    throw new TypeError(
      "PurgeCSS algorithm differs from the pinned upstream source",
    );
  }
  return upstream;
}

if (import.meta.main) {
  const base = new URL("../../extensions/ext-css-purgecss/", import.meta.url);
  const sourcePath = new URL("vendor/purgecss-memory.js", base);
  const license = await Deno.readTextFile(new URL("vendor/LICENSE", base));
  const current = await Deno.readTextFile(sourcePath);
  if (Deno.args.length > 1) {
    throw new TypeError("Expected at most one pinned upstream source path");
  }
  const upstream = Deno.args[0]
    ? await Deno.readTextFile(Deno.args[0])
    : await reconstructPurgeCSSUpstream(current, license);
  const generated = await preparePurgeCSSMemorySource(upstream, license);
  if (generated !== current) {
    throw new TypeError(
      "PurgeCSS source is not the reviewed reproducible distribution",
    );
  }
  console.log(
    "Pinned PurgeCSS source, reversible in-memory edits and MIT attribution verified.",
  );
}
