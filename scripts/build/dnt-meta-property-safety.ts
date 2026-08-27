#!/usr/bin/env -S deno run --allow-read
/**
 * Bans `new.target` in sources that ship through the npm (DNT) build.
 *
 * DNT rewrites `import.meta` into its ESM ponyfill by visiting **meta-property**
 * AST nodes. `new.target` is also a meta-property, and the transform does not
 * distinguish the two: every `new.target` in the emitted package comes out as
 * the `import.meta` ponyfill call. From the published veryfront@0.1.1232
 * tarball, `esm/src/provider/runtime-loader/provider-http.js:44`:
 *
 *   this.name = globalThis[Symbol.for("import-meta-ponyfill-esmodule")](import.meta).name;
 *
 * The source that produced that line is `this.name = new.target.name`.
 *
 * The damage is silent and runtime-only, so nothing in the Deno test suite can
 * see it — the sources are correct, the *emitted package* is not:
 *
 *  - `new.target.name` yields `undefined`, because the ponyfill returns an
 *    `ImportMeta` (which has `url`/`resolve`, never `name`). Every ProviderError
 *    in the published build therefore logs as
 *    `err=undefined: openai request failed: ...` — the class name that should
 *    have told a reader which failure bucket they hit is gone.
 *  - `new.target === SomeClass` yields `false` unconditionally, because an
 *    `ImportMeta` is never a class. Abstract-instantiation guards written that
 *    way (the filesystem adapters) are dead code in the published build.
 *  - When the ponyfill global is not installed on the path that reached the
 *    module, the rewritten expression throws
 *    `TypeError: globalThis[Symbol.for(...)] is not a function` instead.
 *
 * The replacements are ordinary expressions, not meta-properties, so they
 * survive the transform:
 *
 *   this.name = new.target.name
 *     ->  this.name = this.constructor.name
 *
 *   if (new.target === Base) ...
 *     ->  if (Object.getPrototypeOf(this) === Base.prototype) ...
 *
 * Reading a name off `this.constructor` is enough; an identity test is not,
 * because `constructor` is an ordinary inherited property a subclass can delete
 * or overwrite, which would make the subclass answer as the base. Prototype
 * identity is the unforgeable spelling — see `isDirectConstruction` in
 * `src/platform/adapters/native-file-system-provenance.ts`. Both differ from
 * `new.target` only under `Reflect.construct(Base, args, Other)`, which this
 * repo does not do.
 *
 * @module
 */

import { parse } from "#babel/parser";
import { fromFileUrl } from "#std/path";

/** A `new.target` occurrence, which the npm build corrupts. */
export interface MetaPropertyUse {
  file: string;
  line: number;
  /** Source spelling, e.g. `new.target`. */
  expression: string;
}

interface Node {
  type: string;
  loc?: { start: { line: number } };
  [key: string]: unknown;
}

/**
 * Attached comments carry a `type`, so the walk would descend into them and
 * report a `new.target` that only appears in prose — including this file's own
 * header.
 */
const COMMENT_KEYS = new Set([
  "leadingComments",
  "trailingComments",
  "innerComments",
  "comments",
]);

function isNode(value: unknown): value is Node {
  return typeof value === "object" && value !== null &&
    typeof (value as { type?: unknown }).type === "string";
}

/** Raised when a scanned file cannot be parsed, so the audit fails closed. */
export class ParseFailure extends Error {}

/**
 * Report every `new.target` in `source`.
 *
 * Matched on the `MetaProperty` AST node rather than by text, so a mention
 * inside a comment or a string literal is not reported and a line-wrapped
 * `new\n  .target` still is.
 */
export function findBuildUnsafeMetaProperties(
  source: string,
  file: string,
): MetaPropertyUse[] {
  let ast;
  try {
    ast = parse(source, {
      sourceType: "module",
      allowAwaitOutsideFunction: true,
      allowReturnOutsideFunction: true,
      errorRecovery: false,
      plugins: ["typescript", "jsx", "decorators-legacy", "importAttributes"],
    });
  } catch (error) {
    throw new ParseFailure(
      `${file}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const uses: MetaPropertyUse[] = [];

  const visit = (node: Node): void => {
    if (
      node.type === "MetaProperty" && isNode(node.meta) &&
      node.meta.name === "new"
    ) {
      uses.push({
        file,
        line: node.loc?.start.line ?? 0,
        expression: `new.${
          isNode(node.property) ? node.property.name : "target"
        }`,
      });
    }

    for (const key of Object.keys(node)) {
      if (key === "loc" || COMMENT_KEYS.has(key)) continue;
      const value = node[key];
      if (Array.isArray(value)) {
        for (const item of value) if (isNode(item)) visit(item);
      } else if (isNode(value)) {
        visit(value);
      }
    }
  };

  visit(ast.program as unknown as Node);
  return uses.sort((a, b) => a.line - b.line);
}

/** The parts of `deno.json` that decide what DNT compiles. */
export interface ShippedSourceConfig {
  /** The root package's export map — DNT's entry points are derived from it. */
  exports?: Record<string, string>;
  /** Workspace members; the `./extensions/*` ones get their own DNT build. */
  workspace?: string[];
}

/**
 * Source roots copied into a published npm package by a DNT build.
 *
 * Derived rather than listed so a new export or a new extension package cannot
 * quietly fall outside the audit:
 *
 *  - `scripts/build/build-npm-dnt.ts` builds the root package with
 *    `entryPoints` taken straight from `deno.json`'s export map, which today
 *    reaches `src/`, `cli/` and `templates/` (`./scaffold`).
 *  - `scripts/build/build-npm-extension-packages.ts` runs one further DNT build
 *    per first-party `./extensions/*` workspace member.
 *  - `react/` holds the shim modules the root build maps onto the bare
 *    `react`/`react-dom` specifiers; they are part of that module graph.
 */
export function shippedSourceRoots(config: ShippedSourceConfig): string[] {
  const roots = new Set<string>(["react"]);

  for (const path of Object.values(config.exports ?? {})) {
    const root = path.replace(/^\.\//, "").split("/")[0];
    if (root) roots.add(root);
  }

  for (const member of config.workspace ?? []) {
    if (member.startsWith("./extensions/")) {
      roots.add(member.replace(/^\.\//, ""));
    }
  }

  return [...roots].toSorted(compareCodeUnits);
}

/** Code-unit ordering keeps output byte-stable across locales. */
function compareCodeUnits(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

const SOURCE_EXTENSIONS = [".ts", ".tsx"];

/** Every shipped source file under `root`, tests included. */
export async function collectShippedSources(root: string): Promise<string[]> {
  const files: string[] = [];
  try {
    // `Deno.readDir` is lazy: a missing root rejects here, during iteration,
    // not at the call. Only that case is expected — a scan root can be absent
    // in a partial checkout — so every other failure has to keep propagating
    // rather than silently shrink the audited set.
    for await (const entry of Deno.readDir(root)) {
      const path = `${root}/${entry.name}`;
      if (entry.isDirectory) {
        if (entry.name === "node_modules" || entry.name.startsWith(".")) {
          continue;
        }
        files.push(...await collectShippedSources(path));
      } else if (SOURCE_EXTENSIONS.some((ext) => entry.name.endsWith(ext))) {
        files.push(path);
      }
    }
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
  }
  return files;
}

/** Scan the shipped source roots of `repoRoot` for build-unsafe meta-properties. */
export async function auditRepoMetaProperties(
  repoRoot: string,
): Promise<{ uses: MetaPropertyUse[]; parseFailures: string[] }> {
  const uses: MetaPropertyUse[] = [];
  const parseFailures: string[] = [];
  const config = JSON.parse(
    await Deno.readTextFile(`${repoRoot}deno.json`),
  ) as ShippedSourceConfig;

  for (const root of shippedSourceRoots(config)) {
    for (const file of await collectShippedSources(`${repoRoot}${root}`)) {
      const relative = file.slice(repoRoot.length).replaceAll("\\", "/");
      const source = await Deno.readTextFile(file);
      try {
        uses.push(...findBuildUnsafeMetaProperties(source, relative));
      } catch (error) {
        parseFailures.push(
          error instanceof Error ? error.message : String(error),
        );
      }
    }
  }

  return { uses, parseFailures };
}

async function main(): Promise<void> {
  const repoRoot = fromFileUrl(new URL("../../", import.meta.url));
  const { uses, parseFailures } = await auditRepoMetaProperties(repoRoot);

  for (const failure of parseFailures) console.error(`  ${failure}`);
  for (const use of uses) {
    console.error(`  ${use.file}:${use.line}  ${use.expression}`);
  }

  if (uses.length > 0 || parseFailures.length > 0) {
    console.error(
      "\nDNT rewrites every meta-property into its import.meta ponyfill, so the " +
        "published npm build silently turns these into `import.meta`. " +
        "Use `this.constructor` instead — see the header of this script.",
    );
    Deno.exit(1);
  }

  console.log("DNT meta-property safety ok: no new.target in shipped sources.");
}

if (import.meta.main) {
  await main();
}
