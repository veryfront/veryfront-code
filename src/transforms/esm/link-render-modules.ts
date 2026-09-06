import { isBuiltin } from "node:module";
import { BUILD_FAILED } from "#veryfront/errors";
import { resolve as resolveContract } from "#veryfront/extensions/contracts.ts";
import type { ModuleLexer } from "#veryfront/extensions/bundler/module-lexer.ts";
import { isWellFormedString } from "#veryfront/utils/is-well-formed-string.ts";
import { utf8ByteLength } from "#veryfront/utils/utf8-byte-length.ts";
import { initLexer } from "./lexer.ts";
import type { RenderArtifactInput, RenderArtifactLimits } from "./render-artifacts.ts";

export interface RenderModuleSnapshot {
  /** Authorized, captured ESM. URLs identify sources; the linker never opens them. */
  modules: readonly { url: string; source: string }[];
  /** Canonical file URLs without query or fragment, in execution entrypoint order. */
  entrypoints: readonly string[];
}

function snapshot(input: RenderModuleSnapshot, limits: RenderArtifactLimits) {
  const maxEntries = limits.maxEntries;
  const maxBytes = limits.maxBytes;
  const modules = input.modules;
  const roots = input.entrypoints;
  const count = modules?.length;
  const rootCount = roots?.length;
  if (
    !Number.isSafeInteger(maxEntries) || maxEntries < 1 ||
    !Number.isSafeInteger(maxBytes) || maxBytes < 1
  ) throw new RangeError("Render module budgets must be positive safe integers");
  if (!Array.isArray(modules) || count < 1 || count > maxEntries) {
    throw new RangeError("Render module snapshot exceeds its entry budget or is empty");
  }
  const sources = new Map<string, string>();
  let bytes = 0;
  for (let index = 0; index < count; index++) {
    const { url, source } = modules[index]!;
    for (const text of [url, source]) {
      bytes += utf8ByteLength(text, maxBytes - bytes);
      if (bytes > maxBytes) throw new RangeError("Render module snapshot exceeds its byte budget");
      if (!isWellFormedString(text)) {
        throw new TypeError("Render module snapshot must contain lossless UTF-8 text");
      }
    }
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new TypeError("Render module sources require canonical file URLs");
    }
    if (
      parsed.protocol !== "file:" || parsed.href !== url || /[?#]|%2f|%5c/i.test(url) ||
      sources.has(url)
    ) {
      throw new TypeError(
        "Render module sources require distinct canonical file URLs without suffixes",
      );
    }
    sources.set(url, source);
  }
  if (!Array.isArray(roots) || rootCount < 1 || rootCount > count) {
    throw new TypeError("Render module entrypoints must name distinct captured sources");
  }
  const entrypoints: string[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < rootCount; index++) {
    const root = roots[index]!;
    if (!sources.has(root) || seen.has(root)) {
      throw new TypeError("Render module entrypoints must name distinct captured sources");
    }
    seen.add(root);
    entrypoints.push(root);
  }
  return { sources, entrypoints, maxBytes };
}

/**
 * Link captured ESM into a relocatable graph without evaluating or reading it.
 *
 * The caller owns source authorization, canonical file identity (including
 * filesystem aliases), and capture consistency. Missing sources and computed
 * imports fail closed; this does not resolve packages or recover cache files.
 * Only reachable modules are emitted. Root order and import order determine
 * names, independent of replica-local URLs and input enumeration order.
 *
 * Only import literals change. Lazy boundaries, cycles, and URL suffixes remain
 * intact. import.meta refers to the published module, not the original cache.
 * Non-module resources and runtime capabilities remain the executor's policy.
 * The limits independently bound input URL/source bytes and output path/source
 * bytes, not total heap usage. Admission must also bound concurrent linking.
 */
export async function linkRenderModules(
  input: RenderModuleSnapshot,
  limits: RenderArtifactLimits,
): Promise<RenderArtifactInput> {
  const { sources, entrypoints, maxBytes } = snapshot(input, limits);
  const lexer = resolveContract<ModuleLexer>("ModuleLexer");
  const parse = lexer.parse.bind(lexer);
  await initLexer();
  const names = new Map<string, string>();
  const pending: string[] = [];
  function nameOf(url: string): string {
    if (!sources.has(url)) {
      throw BUILD_FAILED.create({ detail: "Render module snapshot is missing an imported source" });
    }
    let name = names.get(url);
    if (name === undefined) {
      name = `module-${names.size}.mjs`;
      names.set(url, name);
      pending.push(url);
    }
    return name;
  }
  const roots = entrypoints.map(nameOf);
  const files: { path: string; source: string }[] = [];
  let bytes = 0;
  const account = (text: string) => {
    bytes += utf8ByteLength(text, maxBytes - bytes);
    if (bytes > maxBytes) throw new RangeError("Linked render modules exceed their byte budget");
    return text;
  };
  for (let index = 0; index < pending.length; index++) {
    const url = pending[index]!;
    const source = sources.get(url)!;
    const path = account(names.get(url)!);
    let imports;
    try {
      imports = parse(source);
    } catch {
      throw BUILD_FAILED.create({ detail: "Render module source could not be parsed" });
    }
    const chunks: string[] = [];
    let cursor = 0;
    for (const imported of imports) {
      if (imported.d === -2) continue;
      const specifier = imported.n;
      if (specifier?.startsWith("node:") && isBuiltin(specifier)) continue;
      if (
        !specifier ||
        !(specifier.startsWith("./") || specifier.startsWith("../") ||
          specifier.startsWith("file:"))
      ) {
        throw BUILD_FAILED.create({
          detail: "Render modules contain an unresolved or external import",
        });
      }
      let target: URL;
      try {
        target = new URL(specifier, url);
      } catch {
        throw BUILD_FAILED.create({ detail: "Render modules contain an invalid import URL" });
      }
      const fullUrl = target.href;
      target.search = "";
      target.hash = "";
      const suffix = fullUrl.slice(target.href.length);
      const replacement = JSON.stringify(`./${nameOf(target.href)}${suffix}`);
      const start = imported.d === -1 ? imported.s - 1 : imported.s;
      const end = imported.d === -1 ? imported.e + 1 : imported.e;
      const quote = source[start];
      if (
        !Number.isSafeInteger(start) || !Number.isSafeInteger(end) ||
        start < cursor || end <= start || end > source.length ||
        (quote !== '"' && quote !== "'") || source[end - 1] !== quote
      ) {
        throw BUILD_FAILED.create({
          detail: "Render module import has an unsupported source span",
        });
      }
      chunks.push(account(source.slice(cursor, start)), account(replacement));
      cursor = end;
    }
    chunks.push(account(source.slice(cursor)));
    files.push({ path, source: chunks.join("") });
  }
  return { files, entrypoints: roots };
}
