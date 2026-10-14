/** Verify the parser-patched Typography distribution without fetching or executing upstream code. */
import recipe from "./typography-source-edits.json" with { type: "json" };

async function digest(text: string): Promise<string> {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)),
    ),
  )
    .map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
function header(license: string): string {
  return "/*!\n" + license + "*/\n" + recipe.imports;
}
function changeSource(
  source: string,
  changes: { before: string; after: string }[],
  reverse: boolean,
): string {
  for (const change of reverse ? changes.toReversed() : changes) {
    const before = reverse ? change.after : change.before;
    const after = reverse ? change.before : change.after;
    if (
      !before || source.indexOf(before) < 0 ||
      source.indexOf(before) !== source.lastIndexOf(before)
    ) {
      throw new TypeError("Typography source edit is missing or ambiguous");
    }
    source = source.replace(before, after);
  }
  return source;
}
export async function prepareTypographySource(
  sources: Record<string, string>,
  license: string,
): Promise<string> {
  if (await digest(license) !== recipe.licenseSHA256) {
    throw new TypeError("Typography license digest mismatch");
  }
  if (Object.keys(sources).length !== Object.keys(recipe.files).length) {
    throw new TypeError("Typography source inventory mismatch");
  }
  let bundled = header(license);
  for (const [name, file] of Object.entries(recipe.files)) {
    const source = sources[name];
    if (typeof source !== "string" || await digest(source) !== file.sha256) {
      throw new TypeError("Typography upstream digest mismatch: " + name);
    }
    bundled += "// BEGIN UPSTREAM " + name + "\n" + file.prefix +
      changeSource(source, file.edits, false) + file.suffix +
      "// END UPSTREAM " + name + "\n";
  }
  return bundled;
}
export async function reconstructTypographyUpstream(
  bundled: string,
  license: string,
): Promise<Record<string, string>> {
  if (
    await digest(license) !== recipe.licenseSHA256 ||
    !bundled.startsWith(header(license))
  ) throw new TypeError("Typography source attribution mismatch");
  let remaining = bundled.slice(header(license).length);
  const sources: Record<string, string> = {};
  for (const [name, file] of Object.entries(recipe.files)) {
    const start = "// BEGIN UPSTREAM " + name + "\n" + file.prefix;
    const end = file.suffix + "// END UPSTREAM " + name + "\n";
    const endIndex = remaining.indexOf(end);
    if (
      !remaining.startsWith(start) || endIndex < start.length ||
      endIndex !== remaining.lastIndexOf(end)
    ) throw new TypeError("Typography source boundaries mismatch");
    const source = changeSource(
      remaining.slice(start.length, endIndex),
      file.edits,
      true,
    );
    if (await digest(source) !== file.sha256) {
      throw new TypeError(
        "Typography algorithm differs from pinned upstream source: " + name,
      );
    }
    sources[name] = source;
    remaining = remaining.slice(endIndex + end.length);
  }
  if (remaining !== "") {
    throw new TypeError("Unexpected trailing Typography source");
  }
  return sources;
}
if (import.meta.main) {
  const base = new URL(
    "../../extensions/ext-css-tailwind/vendor/",
    import.meta.url,
  );
  const bundled = await Deno.readTextFile(new URL("typography.js", base));
  const license = await Deno.readTextFile(new URL("LICENSE", base));
  const sources = await reconstructTypographyUpstream(bundled, license);
  if (await prepareTypographySource(sources, license) !== bundled) {
    throw new TypeError("Typography distribution is not reproducible");
  }
  console.log(
    "Pinned Typography sources, reversible parser-binding edits and MIT attribution verified.",
  );
}
