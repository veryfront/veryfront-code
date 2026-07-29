import {
  basename,
  dirname,
  fromFileUrl,
  join,
  normalize,
  relative,
  resolve,
} from "#std/path";
import {
  assertCanonicalPathEncoding,
  collectConfigurationDependencyEdges,
  configImportMapLayer,
  type ConfigurationDependencyEdge,
  type CoreProductionContext,
  CoreProductionRegistryError,
  type ImportMapLayer,
  isImportableBuiltin,
  loadCoreProductionRegistry,
  resolveConfigRelativePath,
  resolveImportMapSpecifier,
  validateCoreProductionRegistry,
} from "./core-production-roots.ts";
import {
  collectCoreProductionFiles,
  collectSourceDependencies,
  type CoreProductionSourceFile,
  type SourceDependency,
  SourceImportCollectorError,
} from "./source-import-collector.ts";

export interface StrictAuditOperationalError {
  code: string;
  message: string;
  path?: string;
}

export interface StrictAuditIssue {
  code: string;
  contextId: string;
  target: CoreProductionContext["target"];
  path: string;
  line: number;
  column: number;
  specifier?: string;
  resolved?: string;
  loader?: string;
  field?: string;
}

export interface StrictAuditReport {
  evidenceComplete: boolean;
  operationalErrors: StrictAuditOperationalError[];
  issues: StrictAuditIssue[];
  examined: { roots: number; files: number };
}

const SOURCE_EXTENSIONS = [
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
];

function parseArguments(args: string[]): { root: string; output: string } {
  let root = ".";
  let output: string | undefined;
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (argument === "--root") {
      const value = args[++index];
      if (!value) throw new Error("missing value for --root");
      root = value;
    } else if (argument === "--output") {
      const value = args[++index];
      if (!value) throw new Error("missing required --output <path>");
      output = value;
    } else {
      throw new Error(`unknown argument: ${argument}`);
    }
  }
  if (!output) throw new Error("missing required --output <path>");
  return { root, output };
}

function recoverOutputPath(args: string[]): string | undefined {
  const occurrences = args.flatMap((argument, index) =>
    argument === "--output" ? [args[index + 1]] : []
  );
  return occurrences.length === 1 && occurrences[0] &&
      !occurrences[0].startsWith("--")
    ? occurrences[0]
    : undefined;
}

function compareOrdinal(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function operationalError(
  error: unknown,
  repositoryRoot: string,
): StrictAuditOperationalError {
  const absoluteRoot = resolve(repositoryRoot).replaceAll("\\", "/").replace(
    /\/$/,
    "",
  );
  const normalizeMessage = (message: string): string =>
    message.replaceAll("\\", "/").split(absoluteRoot).join("<repository>");
  if (error instanceof SourceImportCollectorError) {
    return {
      code: error.code,
      path: error.path,
      message: normalizeMessage(error.message),
    };
  }
  if (error instanceof CoreProductionRegistryError) {
    return {
      code: error.code,
      message: normalizeMessage(error.message),
      path: error.path,
    };
  }
  const rawMessage = error instanceof Error ? error.message : String(error);
  const message = normalizeMessage(rawMessage);
  const code = /import-map|alias cycle/.test(message)
    ? "import-map-resolution-failure"
    : /configuration|config |compilerOptions|packageRoots|workspaces/.test(
        message,
      )
    ? "configuration-validation-failure"
    : /manifest/.test(message)
    ? "manifest-validation-failure"
    : /entrypoint|context|claim|ownership|production root|eligible production/
        .test(message)
    ? "registry-validation-failure"
    : "audit-operational-failure";
  return {
    code,
    message,
  };
}

function normalizeRepositoryPath(path: string): string {
  return path.replaceAll("\\", "/").replace(/^\.\//, "");
}

function isPathLikeSpecifier(specifier: string): boolean {
  return specifier.startsWith("./") || specifier.startsWith("../") ||
    specifier.startsWith("/") || specifier.startsWith("file:") ||
    specifier.includes("%") &&
      !/^[A-Za-z][A-Za-z0-9+.-]*:/.test(specifier);
}

function hasInvalidPathEncoding(specifier: string): boolean {
  if (!isPathLikeSpecifier(specifier)) return false;
  try {
    assertCanonicalPathEncoding(specifier, "source target");
    return false;
  } catch {
    return true;
  }
}

function sourceCandidate(
  repositoryRoot: string,
  importer: string,
  original: string,
  mapped: string,
): string | undefined {
  if (mapped.startsWith("file:")) {
    const root = resolve(repositoryRoot);
    const filePath = resolve(fromFileUrl(mapped));
    const path = normalizeRepositoryPath(relative(root, filePath));
    return path === ".." || path.startsWith("../") ? undefined : path;
  }
  if (mapped.startsWith("/")) return normalizeRepositoryPath(mapped.slice(1));
  if (mapped.startsWith("./") || mapped.startsWith("../")) {
    return normalizeRepositoryPath(
      mapped !== original
        ? normalize(mapped)
        : normalize(join(dirname(importer), mapped)),
    );
  }
  return undefined;
}

function resolveCollectedFile(
  candidate: string,
  files: ReadonlyMap<string, CoreProductionSourceFile>,
): string | undefined {
  const normalized = normalizeRepositoryPath(normalize(candidate));
  const options = [normalized];
  if (!SOURCE_EXTENSIONS.some((extension) => normalized.endsWith(extension))) {
    for (const extension of SOURCE_EXTENSIONS) {
      options.push(`${normalized}${extension}`);
    }
    for (const extension of SOURCE_EXTENSIONS) {
      options.push(`${normalized}/index${extension}`);
    }
  }
  return options.find((path) => files.has(path));
}

function issue(
  context: CoreProductionContext,
  dependency: SourceDependency,
  code: string,
  resolved?: string,
): StrictAuditIssue {
  return {
    code,
    contextId: context.id,
    target: context.target,
    path: dependency.path,
    line: dependency.line,
    column: dependency.column,
    specifier: dependency.specifier,
    resolved,
    loader: dependency.loader,
  };
}

function classifyDependency(
  repositoryRoot: string,
  context: CoreProductionContext,
  dependency: SourceDependency,
  layers: ImportMapLayer[],
  files: ReadonlyMap<string, CoreProductionSourceFile>,
): { issue?: StrictAuditIssue; sourcePath?: string } {
  if (
    dependency.kind === "unresolved-runtime-loader" || !dependency.specifier
  ) {
    return { issue: issue(context, dependency, "unresolved-runtime-loader") };
  }
  if (dependency.specifier.startsWith("@veryfront/ext-")) {
    return {
      issue: issue(
        context,
        dependency,
        "forbidden-extension-dependency",
        dependency.specifier,
      ),
    };
  }
  if (hasInvalidPathEncoding(dependency.specifier)) {
    return {
      issue: issue(
        context,
        dependency,
        "source-target-escapes-core",
        dependency.specifier,
      ),
    };
  }
  if (dependency.specifier.startsWith("file:")) {
    const rawFileCandidate = sourceCandidate(
      repositoryRoot,
      dependency.path,
      dependency.specifier,
      dependency.specifier,
    );
    if (
      rawFileCandidate === undefined || rawFileCandidate === ".." ||
      rawFileCandidate.startsWith("../") ||
      rawFileCandidate.startsWith("extensions/") ||
      (!rawFileCandidate.startsWith("src/") &&
        !rawFileCandidate.startsWith("cli/"))
    ) {
      return {
        issue: issue(
          context,
          dependency,
          "source-target-escapes-core",
          dependency.specifier,
        ),
      };
    }
  }
  if (dependency.specifier.startsWith("/")) {
    return {
      issue: issue(
        context,
        dependency,
        "source-target-escapes-core",
        dependency.specifier,
      ),
    };
  }
  if (dependency.specifier.startsWith("node:")) {
    if (!isImportableBuiltin(dependency.specifier, context.target)) {
      return {
        issue: issue(
          context,
          dependency,
          "unsupported-or-invalid-builtin",
          dependency.specifier,
        ),
      };
    }
  } else if (
    /^(?:jsr|npm|https?|data|blob|deno|ext):/i.test(dependency.specifier) ||
    /^[A-Za-z][A-Za-z0-9+.-]*:/.test(dependency.specifier) &&
      !dependency.specifier.startsWith("file:")
  ) {
    return {
      issue: issue(
        context,
        dependency,
        "forbidden-external-dependency",
        dependency.specifier,
      ),
    };
  }
  const mapped = resolveImportMapSpecifier(
    dependency.specifier,
    layers,
    dependency.path,
  );
  if (hasInvalidPathEncoding(mapped)) {
    return {
      issue: issue(context, dependency, "source-target-escapes-core", mapped),
    };
  }
  if (mapped.startsWith("/")) {
    return {
      issue: issue(context, dependency, "source-target-escapes-core", mapped),
    };
  }
  const candidate = sourceCandidate(
    repositoryRoot,
    dependency.path,
    dependency.specifier,
    mapped,
  );
  if (candidate !== undefined) {
    if (
      candidate === ".." || candidate.startsWith("../") ||
      candidate.startsWith("extensions/") ||
      (!candidate.startsWith("src/") && !candidate.startsWith("cli/"))
    ) {
      return {
        issue: issue(
          context,
          dependency,
          "source-target-escapes-core",
          candidate,
        ),
      };
    }
    const sourcePath = resolveCollectedFile(candidate, files);
    return sourcePath ? { sourcePath } : {
      issue: issue(
        context,
        dependency,
        "unresolvable-core-source",
        candidate,
      ),
    };
  }
  if (mapped.startsWith("node:")) {
    return isImportableBuiltin(mapped, context.target) ? {} : {
      issue: issue(
        context,
        dependency,
        "unsupported-or-invalid-builtin",
        mapped,
      ),
    };
  }
  if (
    /^(?:jsr|npm|https?|data|blob|deno|ext):/.test(mapped) ||
    /^[A-Za-z][A-Za-z0-9+.-]*:/.test(mapped)
  ) {
    return {
      issue: issue(
        context,
        dependency,
        "forbidden-external-dependency",
        mapped,
      ),
    };
  }
  return {
    issue: issue(context, dependency, "unresolvable-bare-dependency", mapped),
  };
}

function compareIssues(
  left: StrictAuditIssue,
  right: StrictAuditIssue,
): number {
  return compareOrdinal(left.contextId, right.contextId) ||
    compareOrdinal(left.target, right.target) ||
    compareOrdinal(left.path, right.path) || left.line - right.line ||
    left.column - right.column || compareOrdinal(left.code, right.code) ||
    compareOrdinal(left.field ?? "", right.field ?? "") ||
    compareOrdinal(left.specifier ?? "", right.specifier ?? "") ||
    compareOrdinal(left.resolved ?? "", right.resolved ?? "") ||
    compareOrdinal(left.loader ?? "", right.loader ?? "");
}

function isTypeExportField(field: string): boolean {
  return field.startsWith("exports.") && field.split(".").includes("types");
}

function contextOwnsPackageConfig(
  context: CoreProductionContext,
  configPath: string,
): boolean {
  if (configPath === "deno.json") {
    return context.id === "root-node" || context.id === "root-deno" ||
      context.id === "browser-runtime";
  }
  if (configPath === "cli/deno.json") {
    return context.id === "cli-node" || context.id === "cli-deno";
  }
  return context.manifestPaths.includes(configPath);
}

function exportOwnerKey(manifestPath: string, exportName: string): string {
  return `${manifestPath}\0${exportName}`;
}

function collectManifestExportOwners(
  contexts: readonly CoreProductionContext[],
  configurationEdges: ReadonlyMap<
    string,
    readonly ConfigurationDependencyEdge[]
  >,
  repositoryRoot: string,
): Map<string, Set<string>> {
  const owners = new Map<string, Set<string>>();
  for (const context of contexts) {
    for (const entrypoint of context.entrypoints) {
      for (const claim of entrypoint.manifestClaims) {
        const key = exportOwnerKey(claim.manifestPath, claim.exportName);
        const contextIds = owners.get(key) ?? new Set<string>();
        contextIds.add(context.id);
        owners.set(key, contextIds);
      }
    }
  }
  for (const [configPath, edges] of configurationEdges) {
    for (const edge of edges) {
      if (!isTypeExportField(edge.field)) continue;
      const key = exportOwnerKey(configPath, edge.specifier);
      let sourcePath: string;
      try {
        sourcePath = resolveConfigRelativePath(
          repositoryRoot,
          configPath,
          edge.target,
        );
      } catch {
        continue;
      }
      const sourceRoot = sourcePath.split("/")[0];
      for (const context of contexts) {
        if (!context.configPaths.includes(configPath)) continue;
        const ownsSourceRoot = context.assignedSource.some((assignment) =>
          sourcePath.startsWith(assignment.pathPrefix)
        ) || context.entrypoints.some((entrypoint) =>
          entrypoint.path.split("/")[0] === sourceRoot
        );
        if (!ownsSourceRoot) {
          continue;
        }
        const contextIds = owners.get(key) ?? new Set<string>();
        contextIds.add(context.id);
        owners.set(key, contextIds);
      }
    }
  }
  return owners;
}

function conditionalFieldApplies(
  context: CoreProductionContext,
  field: string,
): boolean {
  const conditions = field.split(".").slice(1);
  if (conditions.includes("browser")) return context.target === "browser";
  if (conditions.includes("node") || conditions.includes("require")) {
    return context.target === "node";
  }
  if (conditions.includes("deno")) return context.target === "deno";
  return true;
}

function configurationEdgeApplies(
  context: CoreProductionContext,
  edge: ConfigurationDependencyEdge,
  exportOwners?: ReadonlyMap<string, ReadonlySet<string>>,
): boolean {
  if (edge.field.startsWith("compilerOptions.")) return true;
  if (edge.field === "browser") {
    return context.target === "browser" &&
      contextOwnsPackageConfig(context, edge.configPath);
  }
  if (edge.field === "main" || edge.field === "bin") {
    return context.target === "node" &&
      contextOwnsPackageConfig(context, edge.configPath);
  }
  if (isTypeExportField(edge.field)) {
    const claimOwners = exportOwners?.get(
      exportOwnerKey(edge.configPath, edge.specifier),
    );
    const ownsExport = claimOwners && claimOwners.size > 0
      ? claimOwners.has(context.id)
      : contextOwnsPackageConfig(context, edge.configPath);
    return ownsExport &&
      conditionalFieldApplies(context, edge.field);
  }
  if (
    edge.field === "module" || edge.field === "types" ||
    edge.field === "packageRoots"
  ) return contextOwnsPackageConfig(context, edge.configPath);
  return true;
}

interface SyntheticJsxDependency {
  dependency: SourceDependency;
  field?: string;
}

function isJsxImporter(path: string): boolean {
  return path.endsWith(".tsx") || path.endsWith(".jsx");
}

function isGeneratedJsxRuntimeField(field: string): boolean {
  return field === "compilerOptions.jsxImportSource.runtime" ||
    field === "compilerOptions.jsxImportSource.dev-runtime" ||
    field === "compilerOptions.jsxImportSourceTypes.runtime" ||
    field === "compilerOptions.jsxImportSourceTypes.dev-runtime";
}

function syntheticJsxDependencies(
  path: string,
  dependencies: readonly SourceDependency[],
  context: CoreProductionContext,
  configurationEdges: ReadonlyMap<
    string,
    readonly ConfigurationDependencyEdge[]
  >,
): SyntheticJsxDependency[] {
  if (!isJsxImporter(path)) return [];
  const pragmaSources = dependencies.filter((dependency) =>
    dependency.loader === "@jsxImportSource" && dependency.specifier
  );
  const configured = context.configPaths.flatMap((configPath) =>
    (configurationEdges.get(configPath) ?? []).filter((edge) =>
      isGeneratedJsxRuntimeField(edge.field) &&
      configurationEdgeApplies(context, edge)
    ).map((edge) => ({
      field: edge.field,
      dependency: {
        path,
        line: 1,
        column: 1,
        kind: "runtime-loader" as const,
        loader: edge.field,
        specifier: edge.target,
      },
    }))
  );
  if (pragmaSources.length === 0) return configured;
  const configuredTypes = configured.filter(({ field }) =>
    field?.startsWith("compilerOptions.jsxImportSourceTypes.")
  );
  const overriddenRuntime = pragmaSources.flatMap((pragma) =>
    [
      ["runtime", "jsx-runtime"],
      ["dev-runtime", "jsx-dev-runtime"],
    ].map(([label, suffix]) => ({
      dependency: {
        path,
        line: pragma.line,
        column: pragma.column,
        kind: "runtime-loader" as const,
        loader: `@jsxImportSource.${label}`,
        specifier: `${pragma.specifier!.replace(/\/$/, "")}/${suffix}`,
      },
    }))
  );
  return [...configuredTypes, ...overriddenRuntime];
}

export async function runStrictCoreDependencyAudit(
  root: string,
): Promise<StrictAuditReport> {
  const report: StrictAuditReport = {
    evidenceComplete: false,
    operationalErrors: [],
    issues: [],
    examined: { roots: 0, files: 0 },
  };
  try {
    const registry = await loadCoreProductionRegistry(root);
    report.examined.roots = registry.contexts.length;
    const requiredRoots = [
      ...new Set(registry.contexts.flatMap((context) => [
        ...context.assignedSource.map((assignment) =>
          assignment.pathPrefix.split("/")[0]
        ),
        ...context.entrypoints.map((entrypoint) =>
          entrypoint.path.split("/")[0]
        ),
      ])),
    ].sort();
    const collection = await collectCoreProductionFiles(root, {
      requiredRoots,
      forcedIncludes: registry.contexts.flatMap((context) =>
        context.entrypoints.map((entrypoint) => entrypoint.path)
      ),
    });
    report.examined.files = collection.visitedFileCount;
    validateCoreProductionRegistry(
      registry,
      collection.files.map((file) => file.path),
    );

    const files = new Map(collection.files.map((file) => [file.path, file]));
    // Parse every eligible file before policy evaluation so an unreachable parser
    // failure can never be mistaken for complete evidence.
    for (const file of collection.files) {
      collectSourceDependencies(file);
    }

    const configurationEdges = new Map(
      [...registry.configs.entries()].map(([configPath, config]) => [
        configPath,
        collectConfigurationDependencyEdges(configPath, config),
      ]),
    );
    const exportOwners = collectManifestExportOwners(
      registry.contexts,
      configurationEdges,
      root,
    );

    const states = registry.contexts.map((context) => ({
      context,
      layers: context.configPaths.map((configPath) =>
        configImportMapLayer(configPath, registry.configs.get(configPath)!)
      ),
      queued: new Set(context.entrypoints.map((entrypoint) => entrypoint.path)),
      visited: new Set<string>(),
      dependencies: new Map<string, SourceDependency[]>(),
    }));

    for (const state of states) {
      const { context, layers, queued } = state;
      for (const configPath of context.configPaths) {
        for (const edge of configurationEdges.get(configPath) ?? []) {
          if (
            edge.field === "imports" || edge.field.startsWith("scopes.") ||
            edge.field === "workspace" ||
            edge.field === "workspaces"
          ) continue;
          if (
            edge.field.startsWith("exports") && !isTypeExportField(edge.field)
          ) continue;
          if (!configurationEdgeApplies(context, edge, exportOwners)) {
            continue;
          }
          if (
            [
              "dependencies",
              "peerDependencies",
              "optionalDependencies",
              "bundledDependencies",
              "bundleDependencies",
            ].includes(edge.field)
          ) {
            report.issues.push({
              code: "forbidden-config-dependency",
              contextId: context.id,
              target: context.target,
              path: configPath,
              line: 1,
              column: 1,
              field: edge.field,
              specifier: edge.specifier,
              resolved: edge.target,
            });
            continue;
          }
          const synthetic: SourceDependency = {
            path: configPath,
            line: 1,
            column: 1,
            kind: "runtime-loader",
            loader: edge.field,
            specifier: edge.target,
          };
          const classified = classifyDependency(
            root,
            context,
            synthetic,
            layers,
            files,
          );
          if (classified.issue) {
            report.issues.push({
              ...classified.issue,
              field: edge.field,
              specifier: edge.specifier,
              resolved: classified.issue.resolved ?? edge.target,
            });
          } else if (classified.sourcePath) {
            queued.add(classified.sourcePath);
          }
        }
      }
    }

    const traverse = (state: (typeof states)[number]): void => {
      const { context, layers, queued, visited } = state;
      while (queued.size > 0) {
        const path = [...queued].sort()[0];
        queued.delete(path);
        if (visited.has(path)) continue;
        visited.add(path);
        const file = files.get(path);
        if (!file) {
          throw new Error(`entrypoint-not-collected: ${context.id}: ${path}`);
        }
        let fileDependencies = state.dependencies.get(path);
        if (!fileDependencies) {
          fileDependencies = collectSourceDependencies(file, {
            resolveModuleSpecifier: (specifier, importer) =>
              resolveImportMapSpecifier(specifier, layers, importer),
          });
          state.dependencies.set(path, fileDependencies);
        }
        for (
          const synthetic of syntheticJsxDependencies(
            path,
            fileDependencies,
            context,
            configurationEdges,
          )
        ) {
          const result = classifyDependency(
            root,
            context,
            synthetic.dependency,
            layers,
            files,
          );
          if (result.issue) {
            report.issues.push({
              ...result.issue,
              field: synthetic.field,
            });
          }
          if (result.sourcePath && !visited.has(result.sourcePath)) {
            queued.add(result.sourcePath);
          }
        }
        for (const dependency of fileDependencies) {
          const result = classifyDependency(
            root,
            context,
            dependency,
            layers,
            files,
          );
          if (result.issue) report.issues.push(result.issue);
          if (result.sourcePath && !visited.has(result.sourcePath)) {
            queued.add(result.sourcePath);
          }
        }
      }
    };

    // First compute genuine per-target closure from manifest, runtime, and
    // applicable configuration roots only.
    for (const state of states) traverse(state);
    const globallyReached = new Set(
      states.flatMap((state) => [...state.visited]),
    );

    // Explicit source assignments are fallback ownership for files unreachable
    // from every declared root. They must not make target-only closure universal.
    for (const state of states) {
      for (const file of collection.files) {
        if (
          !globallyReached.has(file.path) &&
          state.context.assignedSource.some((assignment) =>
            file.path.startsWith(assignment.pathPrefix)
          )
        ) state.queued.add(file.path);
      }
      traverse(state);
    }
    report.issues.sort(compareIssues);
    report.evidenceComplete = true;
  } catch (error) {
    report.operationalErrors.push(operationalError(error, root));
  }
  return report;
}

async function writeReportAtomically(
  outputPath: string,
  report: StrictAuditReport,
): Promise<void> {
  const outputDirectory = dirname(outputPath);
  const temporaryPath = `${outputDirectory}/.${
    basename(outputPath)
  }.${crypto.randomUUID()}.tmp`;
  try {
    await Deno.writeTextFile(
      temporaryPath,
      `${JSON.stringify(report, null, 2)}\n`,
      {
        createNew: true,
      },
    );
    await Deno.rename(temporaryPath, outputPath);
  } catch (error) {
    try {
      await Deno.remove(temporaryPath);
    } catch (cleanupError) {
      if (!(cleanupError instanceof Deno.errors.NotFound)) throw cleanupError;
    }
    throw error;
  }
}

if (import.meta.main) {
  let root: string;
  let output: string;
  try {
    ({ root, output } = parseArguments(Deno.args));
  } catch (error) {
    const recoveredOutput = recoverOutputPath(Deno.args);
    const message = error instanceof Error ? error.message : String(error);
    if (recoveredOutput) {
      const report: StrictAuditReport = {
        evidenceComplete: false,
        operationalErrors: [{ code: "invalid-arguments", message }],
        issues: [],
        examined: { roots: 0, files: 0 },
      };
      try {
        await writeReportAtomically(recoveredOutput, report);
      } catch (writeError) {
        console.error(
          `report-write-failure: ${
            writeError instanceof Error
              ? writeError.message
              : String(writeError)
          }`,
        );
        Deno.exit(3);
      }
    }
    console.error(message);
    Deno.exit(3);
  }

  const report = await runStrictCoreDependencyAudit(root);
  try {
    await writeReportAtomically(output, report);
  } catch (error) {
    console.error(
      `report-write-failure: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    Deno.exit(3);
  }
  if (!report.evidenceComplete || report.operationalErrors.length > 0) {
    console.error(
      `Strict core dependency audit incomplete: ${report.operationalErrors.length} error(s).`,
    );
    Deno.exit(3);
  }
  if (report.issues.length > 0) {
    console.error(
      `Strict core dependency audit found ${report.issues.length} policy issue(s).`,
    );
    Deno.exit(2);
  }
  console.log(
    `Strict core dependency audit examined ${report.examined.files} files across ${report.examined.roots} contexts.`,
  );
}
