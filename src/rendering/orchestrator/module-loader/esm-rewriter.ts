import { rendererLogger } from "#veryfront/utils";
import { MODULE_NOT_FOUND } from "#veryfront/errors";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { generateHash } from "./cache.ts";
import { parseImports, replaceSpecifiers } from "#veryfront/transforms/esm/lexer.ts";

const logger = rendererLogger.component("module-loader");

/**
 * Specifiers `code` imports statically, as opposed to through `import(...)` or
 * merely mentioning in a string.
 *
 * A lex failure returns every discovered specifier as static, so an unparseable
 * bundle keeps the pre-graceful-degradation behaviour of failing loudly rather
 * than quietly shipping a remote dependency.
 */
async function staticImportSpecifiers(code: string): Promise<Set<string>> {
  try {
    const imports = await parseImports(code);
    return new Set(
      imports.filter((imp) => imp.d === -1 && imp.n).map((imp) => imp.n as string),
    );
  } catch (error) {
    logger.debug("Could not lex a fetched module; treating its imports as static", {
      error: error instanceof Error ? error.message : String(error),
    });
    return new Set(code.match(/https:\/\/esm\.sh\/[^"']+/g) ?? []);
  }
}

/**
 * Whether the esm.sh rewrite has to redirect `specifier`, i.e. whether leaving
 * it verbatim would make it resolve against wherever the artifact is written
 * rather than against its esm.sh origin.
 */
function needsEsmRewrite(specifier: string): boolean {
  if (specifier.startsWith("./") || specifier.startsWith("../")) return true;
  if (!specifier.startsWith("/")) return false;
  // veryfront module paths are served locally, not via esm.sh.
  return !specifier.startsWith("/_vf_modules/") && !specifier.startsWith("/_veryfront/");
}

/**
 * Point an esm.sh bundle's server-absolute and relative specifiers at absolute
 * esm.sh URLs, so the module still resolves once it is written to a temp file.
 *
 * The rewrite is driven by the module lexer rather than by pattern matching:
 * only a position the lexer reports as a specifier is edited, so ordinary
 * string data that happens to read like an import statement — say
 * `const help = 'from "/v135/help"'` — is left alone. Guessing with a regex
 * would reintroduce exactly the string-versus-specifier confusion this avoids.
 *
 * A bundle the lexer cannot read keeps its specifiers verbatim, which is only
 * sound while every one of them is already absolute. A surviving relative or
 * server-absolute specifier would be resolved against the temp directory the
 * artifact is written to, so the caller would be handed a module that loads the
 * wrong file or none at all; such a bundle fails the load instead.
 */
export async function rewriteEsmPaths(code: string, urlBase: string): Promise<string> {
  try {
    return await replaceSpecifiers(code, (specifier) => {
      if (!needsEsmRewrite(specifier)) return null;
      if (specifier.startsWith("/")) return `https://esm.sh${specifier}`;
      return new URL(specifier, urlBase).href;
    });
  } catch (error) {
    logger.debug("Could not lex a fetched module; leaving its specifiers unrewritten", {
      error: error instanceof Error ? error.message : String(error),
    });
    // Every string literal is examined, not just the ones in an import-looking
    // position. Anchoring on `import`/`from` would mean re-implementing JS
    // syntax with a regex - a comment between the keyword and the specifier, a
    // line continuation, or an `export {a} from` form each need their own
    // case, and a missed one silently reinstates the unloadable artifact this
    // guards against. The lexer has already refused the source by this point,
    // so the only safe direction to err in is refusing too much: a data string
    // that merely looks like a path costs a failed load, never a broken
    // module.
    //
    // The three alternatives are the three JS string forms, each matched
    // escape-aware: an earlier `"a\"b"` would otherwise pair its escaped quote
    // with the next real one and walk the scan out of phase, hiding every
    // specifier after it. The escape pair is `\\[\s\S]` rather than `\\.` so that
    // a line continuation - a backslash before a real newline - is consumed
    // too; `.` stops at a newline and would desynchronise the scan the same
    // way. An unescaped newline still terminates a quoted string, because the
    // character class excludes it. Within each alternative that class and the
    // escape pair are disjoint, so the scan cannot backtrack. Declared inside
    // the handler so `lastIndex` cannot leak between calls.
    const stringLiteral =
      /"((?:[^"\\\n]|\\[\s\S])*)"|'((?:[^'\\\n]|\\[\s\S])*)'|`((?:[^`\\]|\\[\s\S])*)`/g;
    for (let match = stringLiteral.exec(code); match; match = stringLiteral.exec(code)) {
      const specifier = match[1] ?? match[2] ?? match[3];
      if (specifier === undefined || !needsEsmRewrite(specifier)) continue;
      throw MODULE_NOT_FOUND.create({
        detail: `Cannot rewrite ${specifier} in an unlexable module from ${urlBase}: leaving it ` +
          `verbatim would resolve it against the temp directory instead of esm.sh`,
      });
    }
    return code;
  }
}

/** Where `url`'s rewritten source is written. Depends only on `url` and `tmpDir`. */
async function esmTempFilePath(url: string, tmpDir: string): Promise<string> {
  return `${tmpDir}/esm-${await generateHash(url)}.js`;
}

/**
 * Bookkeeping for one top-level fetch, so that artifacts written against a
 * predicted cyclic path are not published to `esmCache` unless the graph that
 * owns that prediction actually finishes.
 */
type GraphState = {
  /**
   * Per-URL set of ancestor URLs whose files an artifact already points at but
   * which have not been written yet. Empty once the owning ancestor writes.
   */
  unwritten: Map<string, Set<string>>;
  /** Cache entries that are only sound if this whole graph succeeds. */
  provisional: Set<string>;
  /** Artifacts written by this graph, published only after the root succeeds. */
  artifacts: Map<string, string>;
  /** Module materializations still running within this graph. */
  inFlight: Map<string, Promise<string>>;
  /** Active in-graph waits between module materializations. */
  waitsFor: Map<string, Map<string, number>>;
  /** Any rejected nested fetch makes the graph unsafe to publish as a cache hit. */
  hadFailure: boolean;
  /** Artifacts that depend on a failed subtree or provisional cycle member. */
  poisoned: Set<string>;
};

function unresolvedGraphDependencies(
  url: string,
  graph: GraphState,
  esmCache: Map<string, string>,
  seen = new Set<string>(),
): string[] {
  if (seen.has(url)) return [];
  seen.add(url);

  const unresolved: string[] = [];
  for (const dependency of graph.unwritten.get(url) ?? []) {
    if (!graph.artifacts.has(dependency) && !esmCache.has(dependency)) {
      unresolved.push(dependency);
      continue;
    }
    unresolved.push(...unresolvedGraphDependencies(dependency, graph, esmCache, seen));
  }
  return unresolved;
}

function addWaitDependency(graph: GraphState, waiter: string | undefined, dependency: string) {
  if (waiter === undefined || waiter === dependency) return () => {};
  let counts = graph.waitsFor.get(waiter);
  if (!counts) {
    counts = new Map();
    graph.waitsFor.set(waiter, counts);
  }
  counts.set(dependency, (counts.get(dependency) ?? 0) + 1);

  let released = false;
  return () => {
    if (released) return;
    released = true;
    const currentCounts = graph.waitsFor.get(waiter);
    if (!currentCounts) return;
    const count = currentCounts.get(dependency);
    if (count === undefined) return;
    if (count > 1) {
      currentCounts.set(dependency, count - 1);
      return;
    }
    currentCounts.delete(dependency);
    if (currentCounts.size === 0) graph.waitsFor.delete(waiter);
  };
}

function transitivelyWaitsFor(
  url: string,
  target: string,
  graph: GraphState,
  seen = new Set<string>(),
): boolean {
  if (seen.has(url)) return false;
  seen.add(url);
  for (const dependency of graph.waitsFor.get(url)?.keys() ?? []) {
    if (dependency === target || transitivelyWaitsFor(dependency, target, graph, seen)) {
      return true;
    }
  }
  return false;
}

export async function fetchEsmModule(
  url: string,
  tmpDir: string,
  localAdapter: RuntimeAdapter,
  esmCache: Map<string, string>,
): Promise<string> {
  const graph: GraphState = {
    unwritten: new Map(),
    provisional: new Set(),
    artifacts: new Map(),
    inFlight: new Map(),
    waitsFor: new Map(),
    hadFailure: false,
    poisoned: new Set(),
  };
  try {
    const result = await fetchEsmModuleWithin(
      url,
      tmpDir,
      localAdapter,
      esmCache,
      new Set(),
      graph,
    );
    const unwritten = unresolvedGraphDependencies(url, graph, esmCache);
    if (unwritten.length) {
      throw MODULE_NOT_FOUND.create({
        detail: `Failed to materialize cyclic dependencies for ${url}: ${unwritten.join(", ")}`,
      });
    }
    for (const [key, value] of graph.artifacts) {
      if (
        !graph.hadFailure || (!graph.provisional.has(key) && !graph.poisoned.has(key))
      ) {
        esmCache.set(key, value);
      }
    }
    return result;
  } catch (error) {
    // Failed graph artifacts stay graph-local and are never published. Do not
    // delete shared-cache entries here: another concurrent graph may have
    // successfully published the same URL after this graph marked it
    // provisional.
    throw error;
  }
}

/**
 * @param pending URLs whose fetch is still unwinding further up this call
 * stack. A dependency graph with a cycle would otherwise recurse forever,
 * because a URL only reaches `esmCache` once its own nested fetches finish.
 */
async function fetchEsmModuleWithin(
  url: string,
  tmpDir: string,
  localAdapter: RuntimeAdapter,
  esmCache: Map<string, string>,
  pending: ReadonlySet<string>,
  graph: GraphState,
  waiter?: string,
): Promise<string> {
  const releaseWait = addWaitDependency(graph, waiter, url);
  const cached = esmCache.get(url);
  try {
    if (cached) return cached;
    const graphCached = graph.artifacts.get(url);
    if (graphCached) {
      // A dependency still unwinding further up this call stack writes its own
      // file only after this frame returns — its `Promise.allSettled` is waiting
      // on us — so awaiting its materialization here would deadlock the render
      // rather than fail it. A concurrent sibling can create the same cycle
      // without sharing the caller's `pending` stack, so active wait edges are
      // also treated as not-yet-settleable. Such a predicted path is validated
      // once by `fetchEsmModule` after the root settles instead.
      const settleable = (dependency: string) =>
        !pending.has(dependency) &&
        (waiter === undefined || !transitivelyWaitsFor(dependency, waiter, graph));
      let unwritten = unresolvedGraphDependencies(url, graph, esmCache).filter(settleable);
      if (unwritten.length) {
        const ownerUrls = [
          ...new Set(unwritten.filter((dependency) => graph.inFlight.has(dependency))),
        ];
        if (ownerUrls.length) {
          const releaseOwnerWaits = ownerUrls.map((ownerUrl) =>
            addWaitDependency(graph, waiter, ownerUrl)
          );
          const owners = ownerUrls
            .map((ownerUrl) => graph.inFlight.get(ownerUrl))
            .filter((owner): owner is Promise<string> => owner !== undefined);
          try {
            await Promise.all(owners);
          } finally {
            for (const release of releaseOwnerWaits) release();
          }
          unwritten = unresolvedGraphDependencies(url, graph, esmCache).filter(settleable);
        }
        if (unwritten.length) {
          throw MODULE_NOT_FOUND.create({
            detail: `Refusing incomplete graph-local artifact for ${url}`,
          });
        }
      }
      return graphCached;
    }

    const inFlight = graph.inFlight.get(url);
    if (inFlight) {
      // Two sibling materializations that import each other each find the other
      // in flight, and neither has reached `graph.artifacts` yet, so the wait
      // edges recorded above are the only evidence that awaiting here would
      // leave both frames blocked on each other forever. Break such a cycle the
      // way a caller-stack cycle is broken: point at the owner's predicted
      // path, which is fixed by `esmTempFilePath`, and let `fetchEsmModule`
      // validate once the root settles that the owner really wrote it.
      if (waiter !== undefined && transitivelyWaitsFor(url, waiter, graph)) {
        return await esmTempFilePath(url, tmpDir);
      }
      await inFlight;
      return await fetchEsmModuleWithin(
        url,
        tmpDir,
        localAdapter,
        esmCache,
        pending,
        graph,
        waiter,
      );
    }

    const materialization = materializeEsmModuleWithin(
      url,
      tmpDir,
      localAdapter,
      esmCache,
      pending,
      graph,
    );
    graph.inFlight.set(url, materialization);
    try {
      return await materialization;
    } finally {
      if (graph.inFlight.get(url) === materialization) graph.inFlight.delete(url);
    }
  } finally {
    releaseWait();
  }
}

async function materializeEsmModuleWithin(
  url: string,
  tmpDir: string,
  localAdapter: RuntimeAdapter,
  esmCache: Map<string, string>,
  pending: ReadonlySet<string>,
  graph: GraphState,
): Promise<string> {
  logger.debug("Fetching esm.sh module:", url);

  const response = await fetch(url);
  if (!response.ok) {
    throw MODULE_NOT_FOUND.create({ detail: `Failed to fetch ${url}: ${response.status}` });
  }

  let code = await response.text();

  // esm.sh canonicalises bare and versionless paths by redirecting, so the URL
  // the response actually came from is the only correct base for the module's
  // relative specifiers; resolving them against the requested URL would fetch a
  // chunk from the wrong directory. A synthetic response carries an empty
  // `url`, so the requested URL stays the fallback.
  const responseUrl = response.url || url;
  const urlBase = responseUrl.substring(0, responseUrl.lastIndexOf("/") + 1);
  code = await rewriteEsmPaths(code, urlBase);

  const allEsmUrls = new Set<string>();
  try {
    for (const imported of await parseImports(code)) {
      if (imported.n?.startsWith("https://esm.sh/")) allEsmUrls.add(imported.n);
    }
  } catch {
    const urlPattern = /["'`](https:\/\/esm\.sh\/[^"'`]+)["'`]/g;
    for (let match = urlPattern.exec(code); match; match = urlPattern.exec(code)) {
      if (match[1]) allEsmUrls.add(match[1]);
    }
  }

  const urlArray = Array.from(allEsmUrls);
  const staticUrls = await staticImportSpecifiers(code);
  const tempFilePath = await esmTempFilePath(url, tmpDir);
  const nested = new Set(pending).add(url);
  // Nested pre-fetches of a URL this module only reaches lazily are
  // best-effort: a broken esm.sh build for one package logs a warning and the
  // URL stays in the emitted code for the runtime to resolve at call time. A
  // URL the module imports statically is part of its own import graph and must
  // still resolve here, so the emitted artifact's static dependencies stay
  // local. See `transforms/esm/specifier-resolver.ts` for the same rule on the
  // SSR transform path.
  const settledPaths = await Promise.allSettled(
    urlArray.map((esmUrl) =>
      // A URL already on this stack is mid-fetch, so re-entering it would never
      // terminate. Its temp path is fixed by `esmTempFilePath`, and the frame
      // that owns it writes the file before the top-level fetch resolves, so a
      // cyclic edge can point at that path without being fetched again.
      nested.has(esmUrl)
        ? esmTempFilePath(esmUrl, tmpDir)
        : fetchEsmModuleWithin(esmUrl, tmpDir, localAdapter, esmCache, nested, graph, url)
    ),
  );

  // Ancestor files this module's emitted code depends on but which nobody has
  // written yet, either because this module closed a cycle itself or because a
  // descendant did.
  const unwritten = new Set<string>();
  let poisonedByDependency = false;

  if (urlArray.length) {
    const replacementMap = new Map<string, string>();
    for (let i = 0; i < urlArray.length; i++) {
      const url = urlArray[i];
      const result = settledPaths[i];
      if (!url || !result) continue;
      if (result.status === "fulfilled") {
        replacementMap.set(url, `file://${result.value}`);
        // A dependency that resolved to a predicted path — an ancestor still
        // unwinding up this stack, or a sibling cycle broken in
        // `fetchEsmModuleWithin` — owns neither a graph artifact nor a cache
        // entry yet, so this module's emitted code points at a file nobody has
        // written. Record it so the artifact stays provisional until it is.
        if (nested.has(url) || (!graph.artifacts.has(url) && !esmCache.has(url))) {
          unwritten.add(url);
        } else {
          for (const dep of graph.unwritten.get(url) ?? []) unwritten.add(dep);
        }
        if (graph.provisional.has(url) || graph.poisoned.has(url)) poisonedByDependency = true;
        continue;
      }

      graph.hadFailure = true;

      // A statically imported dependency must be local before this module is
      // handed to the runtime loader, so its failure stays fatal.
      if (staticUrls.has(url)) throw result.reason;

      logger.warn("Leaving an unfetchable lazy esm.sh module for runtime resolution", {
        url,
        error: result.reason instanceof Error ? result.reason.message : String(result.reason),
      });
    }

    if (replacementMap.size) {
      // Every key was collected from a quoted position above, so a match is
      // only accepted between the same pair of quotes. That is what keeps a URL
      // that is a prefix of another one — `https://esm.sh/react` inside
      // `https://esm.sh/react-dom` — from swallowing the longer URL's head:
      // longest-first ordering alone cannot help when the longer URL failed to
      // fetch and so never entered the map, yet it must stay verbatim for the
      // runtime to resolve.
      try {
        code = await replaceSpecifiers(code, (specifier) => {
          return replacementMap.get(specifier) ?? null;
        });
      } catch (error) {
        logger.debug("Could not lex a fetched module during local substitution", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  await localAdapter.fs.writeFile(tempFilePath, code);

  // This module's own file now exists, so a descendant that pointed at its
  // predicted path is satisfied.
  unwritten.delete(url);
  graph.unwritten.set(url, unwritten);
  graph.artifacts.set(url, tempFilePath);
  if (poisonedByDependency) graph.poisoned.add(url);
  if (unwritten.size) graph.provisional.add(url);
  return tempFilePath;
}
