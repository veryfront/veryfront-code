/**
 * Validation of an API handler module against the remote-import allow-list.
 *
 * Every verdict here comes from the parsed capability analysis
 * (`source-capability-analyzer.ts`). A module that cannot be parsed is
 * rejected outright: the Babel parser extension is a hard dependency of the
 * `veryfront` package, so a missing parser is a broken install and an
 * unparseable module could not run anyway.
 *
 * @module routing/api/module-loader/http-validator
 */
import { createError, toError } from "#veryfront/errors";
import {
  analyzeSourceCapabilities,
  describeSourceParseFailure,
  type WorkerUrlClassification,
} from "./source-capability-analyzer.ts";

export function isAllowedRemoteHost(url: URL, allowedHosts: string[]): boolean {
  return allowedHosts.some((host) => {
    try {
      return new URL(host).origin === url.origin;
    } catch (_) {
      return false;
    }
  });
}

export function validateModuleSpecifierHosts(specifiers: string[], allowedHosts: string[]): void {
  for (const url of specifiers) {
    if (/^(?:data|blob):/i.test(url)) {
      throw toError(
        createError({
          type: "api",
          message:
            "[API] handler build failed: inline module URLs cannot be checked against the remote import allow-list.",
        }),
      );
    }
    if (!/^https?:\/\//i.test(url)) continue;
    if (!url) continue;

    let u: URL;
    try {
      u = new URL(url);
    } catch (_) {
      /* expected: URL may be malformed */
      continue;
    }

    if (isAllowedRemoteHost(u, allowedHosts)) continue;

    const remediation =
      `Add "${u.origin}" to security.remoteHosts in veryfront.config.(ts|js) or replace with an approved CDN (e.g., https://esm.sh).`;

    throw toError(
      createError({
        type: "api",
        message:
          `[API] handler build failed: Remote import blocked by allow-list: ${u.origin}. ${remediation}`,
      }),
    );
  }
}

/**
 * Runtime modules whose exports evaluate source text: code handed to them
 * exists only inside strings, so a vetted module can run a `new Worker(...)`
 * or `import(...)` this validator never saw.
 */
const CODE_EVALUATION_MODULES = new Set([
  "inspector",
  "inspector/promises",
  "node:inspector",
  "node:inspector/promises",
  "node:repl",
  "node:vm",
  "repl",
  "vm",
]);

/**
 * Runtime modules whose exports load other modules outside the graph this
 * validator walks: `createRequire` from `node:module` executes a CommonJS
 * module neither the graph walk nor the bundler's HTTP plugin ever reads.
 */
const UNVALIDATED_LOADER_MODULES = new Set(["node:module", "module"]);

/**
 * Runtime worker modules load an entry in a separate module graph that this
 * validator and its HTTP bundler plugin cannot inspect transitively.
 */
const UNVALIDATED_WORKER_LOADER_MODULES = new Set([
  "node:worker_threads",
  "worker_threads",
]);

/**
 * Child-process modules can launch another JavaScript runtime with broader
 * arguments than this module graph was validated for.
 */
const UNVALIDATED_SUBPROCESS_LOADER_MODULES = new Set([
  "node:child_process",
  "child_process",
  "node:cluster",
  "cluster",
  "node:test",
]);

/**
 * Why importing `specifier` cannot be checked against the allow-list, or null
 * when the module is not restricted. URL schemes are case-insensitive, so the
 * comparison is too.
 */
export function restrictedRuntimeModuleReason(specifier: string): string | null {
  const normalized = specifier.toLowerCase();
  if (CODE_EVALUATION_MODULES.has(normalized)) {
    return `importing "${specifier}" enables code evaluation that cannot be checked against the remote import allow-list`;
  }
  if (UNVALIDATED_LOADER_MODULES.has(normalized)) {
    return `importing "${specifier}" enables module loading (createRequire) that cannot be checked against the remote import allow-list`;
  }
  if (UNVALIDATED_WORKER_LOADER_MODULES.has(normalized)) {
    return `importing "${specifier}" enables Worker module loading that cannot be checked against the remote import allow-list`;
  }
  if (UNVALIDATED_SUBPROCESS_LOADER_MODULES.has(normalized)) {
    return `importing "${specifier}" enables subprocess module loading that cannot be checked against the remote import allow-list`;
  }
  return null;
}

function assertNoRestrictedRuntimeModules(specifiers: readonly string[]): void {
  for (const specifier of specifiers) {
    const reason = restrictedRuntimeModuleReason(specifier);
    if (reason === null) continue;
    throw toError(
      createError({
        type: "api",
        message: `[API] handler build failed: ${reason}.`,
      }),
    );
  }
}

function firstWorkerViolation(
  workers: readonly WorkerUrlClassification[],
): WorkerViolation | null {
  for (const worker of workers) {
    if (worker.kind === "file") return "remote";
    if (worker.kind !== "local") return worker.kind;
    // A local worker without a specifier names an entry no graph walk can vet.
    if (worker.specifier === null) return "dynamic";
    if (worker.requiresUnqualifiedWorkerShim === true) return "shim";
  }
  return null;
}

type WorkerViolation = "remote" | "dynamic" | "shim";

function workerViolationDetail(violation: WorkerViolation): string {
  if (violation === "remote") {
    return "a Worker() loading a remote, inline, or file URL bypasses the remote import allow-list";
  }
  if (violation === "shim") {
    return "a relative string Worker constructor cannot be preserved while bundling";
  }
  return "a Worker() with a non-literal URL cannot be checked against the remote import allow-list";
}

export interface ValidatedModuleScan {
  readonly specifiers: readonly string[];
  readonly hasUnconstrainedDynamicImport: boolean;
  readonly requiresBundling: boolean;
  readonly localWorkerSpecifiers: readonly LocalWorkerSpecifier[];
}

export interface LocalWorkerSpecifier {
  readonly specifier: string;
  readonly resolutionBase: "module" | "route";
}

/**
 * Validate a handler module's imports, workers and capabilities against the
 * remote-import allow-list, and describe how the loader must execute it.
 *
 * Throws when the module cannot be parsed, imports a host outside the
 * allow-list or a restricted runtime module, starts a worker the allow-list
 * cannot vet, may generate code, or has a dynamic import with a non-literal
 * specifier.
 */
export async function validateHTTPImports(
  source: string,
  allowedHosts: string[],
): Promise<ValidatedModuleScan> {
  const analysis = await analyzeSourceCapabilities(source);
  if (analysis === null) {
    const failure = await describeSourceParseFailure();
    throw toError(
      createError({
        type: "api",
        message: failure === "parser-unavailable"
          ? "[API] handler build failed: the capability parser is not installed. Install @veryfront/ext-parser-babel to validate API handlers."
          : "[API] handler build failed: Veryfront could not parse this module as TypeScript or JavaScript, so it cannot validate its imports.",
      }),
    );
  }

  const specifiers = [...analysis.moduleSpecifiers];
  validateModuleSpecifierHosts(specifiers, allowedHosts);
  assertNoRestrictedRuntimeModules(specifiers);
  const workerViolation = firstWorkerViolation(analysis.workers);
  if (workerViolation !== null) {
    throw toError(
      createError({
        type: "api",
        message: `[API] handler build failed: ${workerViolationDetail(workerViolation)}.`,
      }),
    );
  }
  if (analysis.hasDynamicCodeGeneration) {
    throw toError(
      createError({
        type: "api",
        message:
          "[API] handler build failed: dynamic code generation cannot be checked against the remote import allow-list.",
      }),
    );
  }
  if (analysis.hasUnconstrainedDynamicImport) {
    throw toError(
      createError({
        type: "api",
        message:
          "[API] handler build failed: unconstrained dynamic import cannot be allow-listed statically.",
      }),
    );
  }

  return {
    specifiers,
    hasUnconstrainedDynamicImport: false,
    // The import edges are exact, so the bundled path is needed only for a
    // dynamic import (which can execute after validation), an `import.meta`
    // read (whose locations the bundling pipeline rewrites and validates), or
    // JSX (whose implicit runtime import only the bundler validates).
    requiresBundling: analysis.hasDynamicImport || analysis.usesImportMeta || analysis.usesJsx,
    localWorkerSpecifiers: analysis.workers.flatMap((worker) =>
      worker.kind === "local" && worker.specifier !== null
        ? [{ specifier: worker.specifier, resolutionBase: worker.resolutionBase }]
        : []
    ),
  };
}
