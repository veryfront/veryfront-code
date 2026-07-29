import {
  basename,
  dirname,
  fromFileUrl,
  isAbsolute,
  join,
  normalize,
  relative,
  resolve,
  toFileUrl,
} from "#std/path";
import {
  assertCanonicalPathEncoding,
  assertLocalFileUrl,
  collectConfigurationDependencyEdges,
  configImportMapLayer,
  type ConfigurationDependencyEdge,
  CORE_PRODUCTION_PACKAGES,
  type CoreProductionContext,
  CoreProductionRegistryError,
  createImportMapResolver,
  type ImportMapMappingProvenance,
  type ImportMapResolution,
  type ImportMapResolver,
  isFileUrlSpecifier,
  isImportableBuiltin,
  loadCoreProductionRegistry,
  resolveConfigRelativePath,
  validateCoreProductionRegistry,
} from "./core-production-roots.ts";
import { isPathContained } from "../lib/path-containment.ts";
import {
  collectCoreProductionFiles,
  collectSourceDependencies,
  type CoreProductionFileCollection,
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
  trace?: string[];
  terminal?: string;
  hopIndex?: number;
  hopIdentity?: string;
  policyTrace?: Array<{ identity: string; code: string | null }>;
  mapping?: ImportMapMappingProvenance;
  provenanceDecision?: {
    kind: "noncanonical-path-encoding";
    field: "sourceKey" | "selectedAddress" | "sourceScope";
    identity: string;
  };
}

export interface StrictAuditReport {
  evidenceComplete: boolean;
  operationalErrors: StrictAuditOperationalError[];
  issues: StrictAuditIssue[];
  examined: { roots: number; files: number };
}

export interface StrictAuditDependencies {
  collectProductionFiles?: typeof collectCoreProductionFiles;
  collectSourceDependencies?: typeof collectSourceDependencies;
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
    specifier.startsWith("/") || isFileUrlSpecifier(specifier);
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

function identitySourceCandidate(
  repositoryRoot: string,
  importer: string,
  original: string,
  mapped: string,
): string | undefined {
  if (isFileUrlSpecifier(mapped)) {
    const root = resolve(repositoryRoot);
    let filePath: string;
    try {
      const url = assertLocalFileUrl(mapped, "source target");
      url.search = "";
      url.hash = "";
      filePath = resolve(fromFileUrl(url));
    } catch {
      return undefined;
    }
    if (!isPathContained(root, filePath)) return undefined;
    const relativePath = relative(root, filePath);
    if (isAbsolute(relativePath)) return undefined;
    return normalizeRepositoryPath(relativePath);
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

function sourceCandidatePaths(candidate: string): string[] {
  const normalized = normalizeRepositoryPath(normalize(candidate)).replace(
    /\/$/,
    "",
  );
  const options = [normalized];
  if (!SOURCE_EXTENSIONS.some((extension) => normalized.endsWith(extension))) {
    for (const extension of SOURCE_EXTENSIONS) {
      options.push(`${normalized}${extension}`);
    }
    for (const extension of SOURCE_EXTENSIONS) {
      options.push(`${normalized}/index${extension}`);
    }
  }
  return options;
}

function resolveCollectedFile(
  candidate: string,
  files: ReadonlyMap<string, CoreProductionSourceFile>,
): string | undefined {
  const options = sourceCandidatePaths(candidate);
  return options.find((path) => files.has(path));
}

function issue(
  context: CoreProductionContext,
  dependency: SourceDependency,
  code: string,
  resolved?: string,
  evidence?: Pick<
    StrictAuditIssue,
    | "trace"
    | "terminal"
    | "hopIndex"
    | "hopIdentity"
    | "policyTrace"
    | "mapping"
    | "provenanceDecision"
  >,
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
    ...evidence,
  };
}

const MAX_MANIFEST_PACKAGE_NAME_LENGTH = 214;
const MANIFEST_PACKAGE_NAME_COMPONENT = /^[a-z0-9][a-z0-9._-]*$/;
const SCOPED_MANIFEST_PACKAGE_NAME_COMPONENT = /^[a-z0-9_-][a-z0-9._-]*$/;

/**
 * Validate the conservative npm-compatible grammar used only to derive
 * manifest-owned package identities. Names contain lowercase ASCII letters,
 * digits, dots, underscores, and hyphens, with at most 214 characters total.
 * An optional scope uses exactly one slash and starts with an alphanumeric
 * character. The scoped package segment may additionally start with `_` or
 * `-` (for example, `@fixture/_cli`), but never `.`. Unscoped names start with
 * an alphanumeric character. This syntax check does not allow or deny package
 * spellings and does not consult dependency declarations or a registry.
 */
function isManifestPackageName(value: unknown): value is string {
  if (
    typeof value !== "string" || value.length === 0 ||
    value.length > MAX_MANIFEST_PACKAGE_NAME_LENGTH
  ) {
    return false;
  }
  if (!value.startsWith("@")) {
    return MANIFEST_PACKAGE_NAME_COMPONENT.test(value);
  }
  const separatorIndex = value.indexOf("/");
  if (
    separatorIndex < 2 || separatorIndex !== value.lastIndexOf("/")
  ) {
    return false;
  }
  return MANIFEST_PACKAGE_NAME_COMPONENT.test(
    value.slice(1, separatorIndex),
  ) && SCOPED_MANIFEST_PACKAGE_NAME_COMPONENT.test(
    value.slice(separatorIndex + 1),
  );
}

function isOwnedPackageIdentity(
  specifier: string,
  ownedPackageNames: ReadonlySet<string>,
): boolean {
  for (const name of ownedPackageNames) {
    if (specifier === name) return true;
    if (specifier.startsWith(`${name}/`)) {
      const subpath = specifier.slice(name.length + 1);
      return !subpath.includes("\\") &&
        subpath.split("/").every((segment) =>
          segment !== "" && segment !== "." && segment !== ".."
        );
    }
  }
  return false;
}

function manifestSelfSpecifier(name: string, exportName: string): string {
  if (exportName === ".") return name;
  if (!exportName.startsWith("./") || exportName.length === 2) {
    throw new Error(`invalid manifest self export: ${name}: ${exportName}`);
  }
  return `${name}/${exportName.slice(2)}`;
}

function collectManifestSelfResolutions(
  context: CoreProductionContext,
  configs: ReadonlyMap<string, Record<string, unknown>>,
): Map<string, readonly string[]> {
  const packageOwners = new Map<string, string>();
  for (const manifestPath of context.manifestPaths) {
    const name = configs.get(manifestPath)?.name;
    if (!isManifestPackageName(name)) continue;
    const previous = packageOwners.get(name);
    if (previous && previous !== manifestPath) {
      throw new Error(
        `ambiguous manifest self package ownership: ${name}: ${previous}: ${manifestPath}`,
      );
    }
    packageOwners.set(name, manifestPath);
  }
  const claims = context.entrypoints.flatMap((entrypoint) =>
    entrypoint.manifestClaims
  ).sort((left, right) =>
    compareOrdinal(left.manifestPath, right.manifestPath) ||
    compareOrdinal(left.exportName, right.exportName) ||
    (context.target === "universal"
        ? left.alternativeIndex ?? 0
        : left.alternativeIndices?.[context.target] ??
          left.alternativeIndex ?? 0) -
      (context.target === "universal"
        ? right.alternativeIndex ?? 0
        : right.alternativeIndices?.[context.target] ??
          right.alternativeIndex ?? 0) ||
    compareOrdinal(left.path, right.path)
  );
  const resolutions = new Map<string, string[]>();
  for (const claim of claims) {
    const name = configs.get(claim.manifestPath)?.name;
    if (!isManifestPackageName(name)) continue;
    const specifier = manifestSelfSpecifier(name, claim.exportName);
    const targets = resolutions.get(specifier) ?? [];
    const target = `./${claim.identity ?? claim.path}`;
    if (!targets.includes(target)) targets.push(target);
    resolutions.set(specifier, targets);
  }
  return resolutions;
}

interface IdentityPolicyDecision {
  code: string;
  resolved: string;
}

function identityPolicyDecision(
  repositoryRoot: string,
  context: CoreProductionContext,
  dependency: SourceDependency,
  identity: string,
  ownedPackageNames: ReadonlySet<string>,
  importerIdentity: string,
  localPath?: string,
): IdentityPolicyDecision | undefined {
  if (identity.startsWith("@veryfront/ext-")) {
    return { code: "forbidden-extension-dependency", resolved: identity };
  }
  if (hasInvalidPathEncoding(identity)) {
    return { code: "source-target-escapes-core", resolved: identity };
  }
  const pathCandidate = localPath ?? identitySourceCandidate(
    repositoryRoot,
    importerIdentity,
    dependency.specifier!,
    identity,
  );
  if (isFileUrlSpecifier(identity) && pathCandidate === undefined) {
    return { code: "source-target-escapes-core", resolved: identity };
  }
  if (
    pathCandidate !== undefined &&
    (pathCandidate === ".." || pathCandidate.startsWith("../") ||
      pathCandidate.startsWith("extensions/") ||
      !CORE_PRODUCTION_PACKAGES.some((definition) =>
        pathCandidate === definition.sourceRoot ||
        pathCandidate.startsWith(`${definition.sourceRoot}/`)
      ))
  ) {
    return { code: "source-target-escapes-core", resolved: pathCandidate };
  }
  if (identity.startsWith("/")) {
    return { code: "source-target-escapes-core", resolved: identity };
  }
  if (/^node:/i.test(identity)) {
    return isImportableBuiltin(identity, context.target) ? undefined : {
      code: "unsupported-or-invalid-builtin",
      resolved: identity,
    };
  }
  if (
    /^(?:jsr|npm|https?|data|blob|deno|ext):/i.test(identity) ||
    /^[A-Za-z][A-Za-z0-9+.-]*:/.test(identity) &&
      !isFileUrlSpecifier(identity)
  ) {
    return { code: "forbidden-external-dependency", resolved: identity };
  }
  if (
    pathCandidate === undefined && !identity.startsWith("#") &&
    !isOwnedPackageIdentity(identity, ownedPackageNames)
  ) {
    return { code: "forbidden-bare-dependency", resolved: identity };
  }
  return undefined;
}

interface ClassifiedDependency {
  issues: StrictAuditIssue[];
  sourceNodes: SourceGraphNode[];
}

interface SourceGraphNode {
  /** Full logical importer identity used by Deno scope matching. */
  identity: string;
  /** Physical collected source path used for parsing and reporting. */
  path: string;
}

interface SourceGraphCandidate {
  identity: string;
  path: string;
}

function graphIdentityForSource(identity: string, sourcePath: string): string {
  const decorationIndex = identity.search(/[?#]/);
  const decoration = decorationIndex < 0 ? "" : identity.slice(decorationIndex);
  return `${sourcePath}${decoration}`;
}

function physicalRepositoryIdentity(identity: string): string {
  const decorationIndex = identity.search(/[?#]/);
  const physical = decorationIndex < 0
    ? identity
    : identity.slice(0, decorationIndex);
  return normalizeRepositoryPath(physical).replace(/^\.\//, "");
}

function issueForTrace(
  context: CoreProductionContext,
  dependency: SourceDependency,
  code: string,
  resolved: string | undefined,
  trace: readonly string[],
  decisions: readonly (IdentityPolicyDecision | undefined)[],
  hopIndex: number,
  mapping?: ImportMapMappingProvenance,
): StrictAuditIssue {
  const policyTrace = trace.map((identity, index) => ({
    identity,
    code: decisions[index]?.code ?? null,
  }));
  if (policyTrace[hopIndex]?.code === null) {
    policyTrace[hopIndex] = { identity: trace[hopIndex], code };
  }
  return issue(context, dependency, code, resolved, {
    trace: [...trace],
    terminal: trace.at(-1),
    hopIndex,
    hopIdentity: trace[hopIndex],
    policyTrace,
    ...(mapping ? { mapping } : {}),
  });
}

function issuesForMappingProvenance(
  context: CoreProductionContext,
  dependency: SourceDependency,
  trace: readonly string[],
  decisions: readonly (IdentityPolicyDecision | undefined)[],
  mapping: ImportMapMappingProvenance | undefined,
): StrictAuditIssue[] {
  if (!mapping) return [];
  const policyTrace = trace.map((identity, index) => ({
    identity,
    code: decisions[index]?.code ?? null,
  }));
  const candidates = [
    ["sourceKey", mapping.sourceKey],
    ["selectedAddress", mapping.selectedAddress],
    ["sourceScope", mapping.sourceScope],
  ] as const;
  return candidates.flatMap(([field, identity]) =>
    identity !== undefined && hasInvalidPathEncoding(identity)
      ? [
        issue(
          context,
          dependency,
          "source-target-escapes-core",
          identity,
          {
            trace: [...trace],
            terminal: trace.at(-1),
            policyTrace,
            mapping,
            provenanceDecision: {
              kind: "noncanonical-path-encoding",
              field,
              identity,
            },
          },
        ),
      ]
      : []
  );
}

function classifyResolvedTrace(
  repositoryRoot: string,
  context: CoreProductionContext,
  dependency: SourceDependency,
  resolution: ImportMapResolution,
  files: ReadonlyMap<string, CoreProductionSourceFile>,
  ownedPackageNames: ReadonlySet<string>,
  importerIdentity: string,
): ClassifiedDependency {
  const { trace, mapping } = resolution;
  const decisions = trace.map((identity, index) =>
    identityPolicyDecision(
      repositoryRoot,
      context,
      dependency,
      identity,
      ownedPackageNames,
      importerIdentity,
      index === trace.length - 1 ? resolution.localPath : undefined,
    )
  );
  const issues = decisions.flatMap((decision, hopIndex) =>
    decision
      ? [
        issueForTrace(
          context,
          dependency,
          decision.code,
          decision.resolved,
          trace,
          decisions,
          hopIndex,
          mapping,
        ),
      ]
      : []
  );
  issues.push(...issuesForMappingProvenance(
    context,
    dependency,
    trace,
    decisions,
    mapping,
  ));
  const terminal = trace.at(-1)!;
  if (decisions.at(-1)) return { issues, sourceNodes: [] };

  const candidate = resolution.localPath;
  if (candidate !== undefined) {
    const sourcePath = resolveCollectedFile(candidate, files);
    if (sourcePath) {
      return {
        issues,
        sourceNodes: [{
          identity: graphIdentityForSource(resolution.resolved, sourcePath),
          path: sourcePath,
        }],
      };
    }
    issues.push(issueForTrace(
      context,
      dependency,
      "unresolvable-core-source",
      candidate,
      trace,
      decisions,
      trace.length - 1,
      mapping,
    ));
    return { issues, sourceNodes: [] };
  }
  if (
    terminal.startsWith("node:") || /^node:/i.test(terminal) &&
      context.target === "deno"
  ) return { issues, sourceNodes: [] };
  issues.push(issueForTrace(
    context,
    dependency,
    "unresolvable-bare-dependency",
    terminal,
    trace,
    decisions,
    trace.length - 1,
    mapping,
  ));
  return { issues, sourceNodes: [] };
}

function classifyDependency(
  repositoryRoot: string,
  context: CoreProductionContext,
  dependency: SourceDependency,
  resolver: ImportMapResolver,
  files: ReadonlyMap<string, CoreProductionSourceFile>,
  ownedPackageNames: ReadonlySet<string>,
  selfResolutions: ReadonlyMap<string, readonly string[]>,
  importerIdentity = dependency.path,
): ClassifiedDependency {
  if (
    dependency.kind === "unresolved-runtime-loader" || !dependency.specifier
  ) {
    return {
      issues: [
        issue(context, dependency, "unresolved-runtime-loader", undefined, {
          trace: [],
          policyTrace: [],
        }),
      ],
      sourceNodes: [],
    };
  }
  const resolution = resolver.resolveWithTrace(
    dependency.specifier,
    importerIdentity,
  );
  if (
    isOwnedPackageIdentity(resolution.resolved, ownedPackageNames)
  ) {
    const targets = selfResolutions.get(resolution.resolved);
    if (!targets || targets.length === 0) {
      const decisions = resolution.trace.map((identity) =>
        identityPolicyDecision(
          repositoryRoot,
          context,
          dependency,
          identity,
          ownedPackageNames,
          importerIdentity,
        )
      );
      const issues = decisions.flatMap((decision, hopIndex) =>
        decision
          ? [issueForTrace(
            context,
            dependency,
            decision.code,
            decision.resolved,
            resolution.trace,
            decisions,
            hopIndex,
            resolution.mapping,
          )]
          : []
      );
      issues.push(...issuesForMappingProvenance(
        context,
        dependency,
        resolution.trace,
        decisions,
        resolution.mapping,
      ));
      issues.push(issueForTrace(
        context,
        dependency,
        "unexported-self-reference",
        resolution.resolved,
        resolution.trace,
        decisions,
        resolution.trace.length - 1,
        resolution.mapping,
      ));
      return {
        issues,
        sourceNodes: [],
      };
    }
    const classified = targets.map((target) =>
      classifyResolvedTrace(
        repositoryRoot,
        context,
        dependency,
        {
          resolved: target,
          trace: resolution.trace.at(-1) === target
            ? [...resolution.trace]
            : [...resolution.trace, target],
          origin: { kind: "request", base: "importer" },
          localPath: physicalRepositoryIdentity(target),
          ...(resolution.mapping ? { mapping: resolution.mapping } : {}),
        },
        files,
        ownedPackageNames,
        importerIdentity,
      )
    );
    return {
      issues: classified.flatMap((result) => result.issues),
      sourceNodes: [...new Map(
        classified.flatMap((result) => result.sourceNodes).map((node) => [
          node.identity,
          node,
        ]),
      ).values()],
    };
  }
  return classifyResolvedTrace(
    repositoryRoot,
    context,
    dependency,
    resolution,
    files,
    ownedPackageNames,
    importerIdentity,
  );
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
    compareOrdinal(left.loader ?? "", right.loader ?? "") ||
    compareOrdinal(left.terminal ?? "", right.terminal ?? "") ||
    (left.hopIndex ?? -1) - (right.hopIndex ?? -1) ||
    compareOrdinal(left.hopIdentity ?? "", right.hopIdentity ?? "") ||
    compareOrdinal(
      JSON.stringify(left.trace ?? []),
      JSON.stringify(right.trace ?? []),
    ) ||
    compareOrdinal(
      JSON.stringify(left.policyTrace ?? []),
      JSON.stringify(right.policyTrace ?? []),
    ) ||
    compareOrdinal(
      JSON.stringify(left.mapping ?? null),
      JSON.stringify(right.mapping ?? null),
    ) ||
    compareOrdinal(
      JSON.stringify(left.provenanceDecision ?? null),
      JSON.stringify(right.provenanceDecision ?? null),
    );
}

function completeIssueIdentity(issue: StrictAuditIssue): string {
  return JSON.stringify([
    issue.code,
    issue.contextId,
    issue.target,
    issue.path,
    issue.line,
    issue.column,
    issue.specifier ?? null,
    issue.resolved ?? null,
    issue.loader ?? null,
    issue.field ?? null,
    issue.trace ?? null,
    issue.terminal ?? null,
    issue.hopIndex ?? null,
    issue.hopIdentity ?? null,
    issue.policyTrace ?? null,
    issue.mapping ?? null,
    issue.provenanceDecision ?? null,
  ]);
}

function deduplicateIssues(
  issues: readonly StrictAuditIssue[],
): StrictAuditIssue[] {
  const unique = new Map<string, StrictAuditIssue>();
  for (const entry of issues) unique.set(completeIssueIdentity(entry), entry);
  return [...unique.values()].sort(compareIssues);
}

function isTypeExportField(field: string): boolean {
  return field.startsWith("exports.") && field.split(".").includes("types");
}

function contextOwnsPackageConfig(
  context: CoreProductionContext,
  configPath: string,
): boolean {
  return context.packageConfigPaths.includes(configPath);
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
  configs: ReadonlyMap<string, Record<string, unknown>>,
  configurationEdges: ReadonlyMap<
    string,
    readonly ConfigurationDependencyEdge[]
  >,
): SyntheticJsxDependency[] {
  if (!isJsxImporter(path)) return [];
  const jsxMode = context.configPaths.map((configPath) => {
    const compilerOptions = configs.get(configPath)?.compilerOptions;
    return compilerOptions && typeof compilerOptions === "object" &&
        !Array.isArray(compilerOptions)
      ? (compilerOptions as Record<string, unknown>).jsx
      : undefined;
  }).find((mode) => mode !== undefined);
  const runtimeSuffix = jsxMode === "react-jsxdev"
    ? "jsx-dev-runtime"
    : jsxMode === "react-jsx" || jsxMode === "precompile"
    ? "jsx-runtime"
    : undefined;
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
  if (pragmaSources.length === 0 || runtimeSuffix === undefined) {
    return configured;
  }
  const configuredTypes = configured.filter(({ field }) =>
    field?.startsWith("compilerOptions.jsxImportSourceTypes.")
  );
  const label = runtimeSuffix === "jsx-runtime" ? "runtime" : "dev-runtime";
  const overriddenRuntime = pragmaSources.map((pragma) => ({
    dependency: {
      path,
      line: pragma.line,
      column: pragma.column,
      kind: "runtime-loader" as const,
      loader: `@jsxImportSource.${label}`,
      specifier: `${pragma.specifier}/${runtimeSuffix}`,
    },
  }));
  return [...configuredTypes, ...overriddenRuntime];
}

interface ResolvedProductionClosure {
  collection: CoreProductionFileCollection;
  baselinePaths: Set<string>;
  dependenciesByContext: Map<string, Map<string, SourceDependency[]>>;
}

interface ClosureScanState {
  context: CoreProductionContext;
  resolver: ImportMapResolver;
  ownedPackageNames: Set<string>;
  selfResolutions: Map<string, readonly string[]>;
  queued: Map<string, SourceGraphNode>;
  scanned: Set<string>;
  candidates: Map<string, SourceGraphCandidate>;
  dependencies: Map<string, SourceDependency[]>;
}

function entrypointRequest(
  repositoryRoot: string,
  entrypoint: { identity?: string; path: string },
): string {
  const identity = entrypoint.identity ?? entrypoint.path;
  const decorationIndex = identity.search(/[?#]/);
  const physical = decorationIndex < 0
    ? identity
    : identity.slice(0, decorationIndex);
  const decoration = decorationIndex < 0 ? "" : identity.slice(decorationIndex);
  return `${toFileUrl(resolve(repositoryRoot, physical)).href}${decoration}`;
}

function localGraphCandidates(
  state: Pick<
    ClosureScanState,
    "resolver" | "ownedPackageNames" | "selfResolutions"
  >,
  specifier: string,
  importerIdentity?: string,
): SourceGraphCandidate[] {
  const resolution = state.resolver.resolveWithTrace(
    specifier,
    importerIdentity,
  );
  if (resolution.localPath !== undefined) {
    return [{
      identity: resolution.resolved,
      path: resolution.localPath,
    }];
  }
  if (
    isOwnedPackageIdentity(
      resolution.resolved,
      state.ownedPackageNames,
    )
  ) {
    return (state.selfResolutions.get(resolution.resolved) ?? []).map(
      (target) => ({
        identity: target,
        path: physicalRepositoryIdentity(target),
      }),
    );
  }
  return [];
}

const POLICY_ONLY_CONFIGURATION_FIELDS = new Set([
  "dependencies",
  "peerDependencies",
  "optionalDependencies",
  "bundledDependencies",
  "bundleDependencies",
]);

function applicableConfigurationCodeEdges(
  context: CoreProductionContext,
  configurationEdges: ReadonlyMap<
    string,
    readonly ConfigurationDependencyEdge[]
  >,
  exportOwners: ReadonlyMap<string, ReadonlySet<string>>,
): ConfigurationDependencyEdge[] {
  return context.configPaths.flatMap((configPath) =>
    (configurationEdges.get(configPath) ?? []).filter((edge) => {
      if (
        edge.field === "imports" || edge.field.startsWith("scopes.") ||
        edge.field === "workspace" || edge.field === "workspaces" ||
        POLICY_ONLY_CONFIGURATION_FIELDS.has(edge.field) ||
        isGeneratedJsxRuntimeField(edge.field)
      ) return false;
      if (edge.field.startsWith("exports") && !isTypeExportField(edge.field)) {
        return false;
      }
      return configurationEdgeApplies(context, edge, exportOwners);
    })
  );
}

async function collectResolvedProductionClosure(
  root: string,
  contexts: readonly CoreProductionContext[],
  resolvers: ReadonlyMap<string, ImportMapResolver>,
  configs: ReadonlyMap<string, Record<string, unknown>>,
  configurationEdges: ReadonlyMap<
    string,
    readonly ConfigurationDependencyEdge[]
  >,
  exportOwners: ReadonlyMap<string, ReadonlySet<string>>,
  requiredRoots: readonly string[],
  initialForcedIncludes: readonly string[],
  collectProductionFiles: typeof collectCoreProductionFiles,
  collectDependencies: typeof collectSourceDependencies,
): Promise<ResolvedProductionClosure> {
  const forcedIncludes = new Set(initialForcedIncludes);
  let collection = await collectProductionFiles(root, {
    requiredRoots,
    forcedIncludes: [...forcedIncludes],
  });
  const baselinePaths = new Set(collection.files.map((file) => file.path));
  const rawParsed = new Set<string>();
  const parseNewRawFiles = (): void => {
    for (const file of collection.files) {
      if (rawParsed.has(file.path)) continue;
      collectDependencies(file);
      rawParsed.add(file.path);
    }
  };
  parseNewRawFiles();

  const scanStates = new Map<string, ClosureScanState>();
  for (const context of contexts) {
    const resolver = resolvers.get(context.id);
    if (!resolver) throw new Error(`missing context resolver: ${context.id}`);
    const ownedPackageNames = new Set(
      context.manifestPaths.flatMap((manifestPath) => {
        const name = configs.get(manifestPath)?.name;
        return isManifestPackageName(name) ? [name] : [];
      }),
    );
    scanStates.set(context.id, {
      context,
      resolver,
      ownedPackageNames,
      selfResolutions: collectManifestSelfResolutions(context, configs),
      queued: new Map(),
      scanned: new Set(),
      candidates: new Map(),
      dependencies: new Map(),
    });
  }

  for (const state of scanStates.values()) {
    for (const entrypoint of state.context.entrypoints) {
      for (
        const candidate of localGraphCandidates(
          state,
          entrypointRequest(root, entrypoint),
        )
      ) state.candidates.set(candidate.identity, candidate);
    }
  }

  for (const state of scanStates.values()) {
    for (
      const edge of applicableConfigurationCodeEdges(
        state.context,
        configurationEdges,
        exportOwners,
      )
    ) {
      const dependency: SourceDependency = {
        path: edge.configPath,
        line: 1,
        column: 1,
        kind: "runtime-loader",
        loader: edge.field,
        specifier: edge.target,
      };
      for (
        const candidate of localGraphCandidates(
          state,
          dependency.specifier!,
          edge.configPath,
        )
      ) {
        if (
          requiredRoots.some((sourceRoot) =>
            candidate.path === sourceRoot ||
            candidate.path.startsWith(`${sourceRoot}/`)
          )
        ) {
          state.candidates.set(candidate.identity, candidate);
        }
      }
    }
  }

  const settle = async (): Promise<void> => {
    // Every pass scans each context/file pair at most once and only adds paths
    // to monotonic candidate/forced sets, so the finite repository converges.
    while (true) {
      const files = new Map(collection.files.map((file) => [file.path, file]));
      const pendingForced = new Set<string>();

      const enqueueCandidate = (
        state: ClosureScanState,
        candidate: SourceGraphCandidate,
      ): void => {
        if (
          !requiredRoots.some((sourceRoot) =>
            candidate.path === sourceRoot ||
            candidate.path.startsWith(`${sourceRoot}/`)
          )
        ) {
          return;
        }
        state.candidates.set(candidate.identity, candidate);
        const sourcePath = resolveCollectedFile(candidate.path, files);
        if (sourcePath) {
          const node: SourceGraphNode = {
            identity: graphIdentityForSource(candidate.identity, sourcePath),
            path: sourcePath,
          };
          if (!state.scanned.has(node.identity)) {
            state.queued.set(node.identity, node);
          }
          return;
        }
        for (const forcedPath of sourceCandidatePaths(candidate.path)) {
          if (!forcedIncludes.has(forcedPath)) pendingForced.add(forcedPath);
        }
      };

      for (const state of scanStates.values()) {
        for (const candidate of state.candidates.values()) {
          enqueueCandidate(state, candidate);
        }
        while (state.queued.size > 0) {
          const identity = [...state.queued.keys()].sort(compareOrdinal)[0];
          const node = state.queued.get(identity)!;
          state.queued.delete(identity);
          if (state.scanned.has(identity)) continue;
          const file = files.get(node.path);
          if (!file) {
            enqueueCandidate(state, node);
            continue;
          }
          state.scanned.add(identity);
          const fileDependencies = collectDependencies(file, {
            resolveModuleSpecifier: (specifier) =>
              state.resolver.resolve(specifier, identity),
          });
          state.dependencies.set(identity, fileDependencies);
          const dependencies = [
            ...fileDependencies,
            ...syntheticJsxDependencies(
              node.path,
              fileDependencies,
              state.context,
              configs,
              configurationEdges,
            ).map((entry) => entry.dependency),
          ];
          for (const dependency of dependencies) {
            if (dependency.loader === "@jsxImportSource") continue;
            if (!dependency.specifier) continue;
            for (
              const candidate of localGraphCandidates(
                state,
                dependency.specifier,
                identity,
              )
            ) {
              enqueueCandidate(state, candidate);
            }
          }
        }
      }

      if (pendingForced.size === 0) return;
      for (const path of pendingForced) forcedIncludes.add(path);
      collection = await collectProductionFiles(root, {
        requiredRoots,
        forcedIncludes: [...forcedIncludes],
      });
      parseNewRawFiles();
    }
  };

  await settle();
  const genuinelyReached = new Set<string>();
  for (const state of scanStates.values()) {
    for (const identity of state.scanned) {
      const candidate = state.candidates.get(identity);
      if (candidate) genuinelyReached.add(candidate.path);
      else genuinelyReached.add(identity.replace(/[?#].*$/, ""));
    }
  }
  for (const state of scanStates.values()) {
    for (const path of baselinePaths) {
      if (
        !genuinelyReached.has(path) &&
        state.context.assignedSource.some((assignment) =>
          path.startsWith(assignment.pathPrefix)
        )
      ) {
        state.queued.set(path, { identity: path, path });
      }
    }
  }
  await settle();

  return {
    collection,
    baselinePaths,
    dependenciesByContext: new Map(
      [...scanStates].map(([contextId, state]) => [
        contextId,
        state.dependencies,
      ]),
    ),
  };
}

export async function runStrictCoreDependencyAudit(
  root: string,
  dependencies: StrictAuditDependencies = {},
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
    const contextResolvers = new Map(
      registry.contexts.map((context) => [
        context.id,
        createImportMapResolver(
          context.configPaths.map((configPath) =>
            configImportMapLayer(
              configPath,
              registry.configs.get(configPath)!,
              root,
            )
          ),
        ),
      ]),
    );
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
    const requiredRoots = CORE_PRODUCTION_PACKAGES.map((definition) =>
      definition.sourceRoot
    ).sort(compareOrdinal);
    const { collection, baselinePaths, dependenciesByContext } =
      await collectResolvedProductionClosure(
        root,
        registry.contexts,
        contextResolvers,
        registry.configs,
        configurationEdges,
        exportOwners,
        requiredRoots,
        registry.contexts.flatMap((context) =>
          context.entrypoints.map((entrypoint) => entrypoint.path)
        ),
        dependencies.collectProductionFiles ?? collectCoreProductionFiles,
        dependencies.collectSourceDependencies ?? collectSourceDependencies,
      );
    report.examined.files = collection.visitedFileCount;
    validateCoreProductionRegistry(
      registry,
      collection.files.map((file) => file.path),
    );

    const files = new Map(collection.files.map((file) => [file.path, file]));

    const states = registry.contexts.map((context) => {
      const resolver = contextResolvers.get(context.id);
      if (!resolver) throw new Error(`missing context resolver: ${context.id}`);
      return {
        context,
        resolver,
        ownedPackageNames: new Set(
          context.manifestPaths.flatMap((manifestPath) => {
            const name = registry.configs.get(manifestPath)?.name;
            return isManifestPackageName(name) ? [name] : [];
          }),
        ),
        selfResolutions: collectManifestSelfResolutions(
          context,
          registry.configs,
        ),
        queued: new Map<string, SourceGraphNode>(),
        visited: new Map<string, SourceGraphNode>(),
        dependencies: dependenciesByContext.get(context.id) ??
          new Map<string, SourceDependency[]>(),
      };
    });

    for (const state of states) {
      const {
        context,
        resolver,
        ownedPackageNames,
        selfResolutions,
        queued,
      } = state;
      for (const entrypoint of context.entrypoints) {
        const request = entrypointRequest(root, entrypoint);
        const synthetic: SourceDependency = {
          path: entrypoint.path,
          line: 1,
          column: 1,
          kind: "runtime-loader",
          loader: "production-entrypoint",
          specifier: request,
        };
        const classified = classifyResolvedTrace(
          root,
          context,
          synthetic,
          resolver.resolveWithTrace(request),
          files,
          ownedPackageNames,
          entrypoint.identity ?? entrypoint.path,
        );
        report.issues.push(...classified.issues);
        for (const node of classified.sourceNodes) {
          queued.set(node.identity, node);
        }
      }
      for (const configPath of context.configPaths) {
        for (const edge of configurationEdges.get(configPath) ?? []) {
          if (
            edge.field === "imports" || edge.field.startsWith("scopes.") ||
            edge.field === "workspace" ||
            edge.field === "workspaces" ||
            isGeneratedJsxRuntimeField(edge.field)
          ) continue;
          if (
            edge.field.startsWith("exports") && !isTypeExportField(edge.field)
          ) continue;
          if (!configurationEdgeApplies(context, edge, exportOwners)) {
            continue;
          }
          if (POLICY_ONLY_CONFIGURATION_FIELDS.has(edge.field)) {
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
              trace: [edge.target],
              terminal: edge.target,
              hopIndex: 0,
              hopIdentity: edge.target,
              policyTrace: [{
                identity: edge.target,
                code: "forbidden-config-dependency",
              }],
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
            resolver,
            files,
            ownedPackageNames,
            selfResolutions,
          );
          for (const classifiedIssue of classified.issues) {
            report.issues.push({
              ...classifiedIssue,
              field: edge.field,
              specifier: edge.specifier,
              resolved: classifiedIssue.resolved ?? edge.target,
            });
          }
          for (const node of classified.sourceNodes) {
            queued.set(node.identity, node);
          }
        }
      }
    }

    const traverse = (state: (typeof states)[number]): void => {
      const {
        context,
        resolver,
        ownedPackageNames,
        selfResolutions,
        queued,
        visited,
      } = state;
      while (queued.size > 0) {
        const identity = [...queued.keys()].sort(compareOrdinal)[0];
        const node = queued.get(identity)!;
        queued.delete(identity);
        if (visited.has(identity)) continue;
        visited.set(identity, node);
        const file = files.get(node.path);
        if (!file) {
          throw new Error(
            `entrypoint-not-collected: ${context.id}: ${node.path}`,
          );
        }
        let fileDependencies = state.dependencies.get(identity);
        if (!fileDependencies) {
          fileDependencies = (dependencies.collectSourceDependencies ??
            collectSourceDependencies)(file, {
              resolveModuleSpecifier: (specifier) =>
                resolver.resolve(specifier, identity),
            });
          state.dependencies.set(identity, fileDependencies);
        }
        for (
          const synthetic of syntheticJsxDependencies(
            node.path,
            fileDependencies,
            context,
            registry.configs,
            configurationEdges,
          )
        ) {
          const result = classifyDependency(
            root,
            context,
            synthetic.dependency,
            resolver,
            files,
            ownedPackageNames,
            selfResolutions,
            identity,
          );
          for (const resultIssue of result.issues) {
            report.issues.push({
              ...resultIssue,
              field: synthetic.field,
            });
          }
          for (const sourceNode of result.sourceNodes) {
            if (!visited.has(sourceNode.identity)) {
              queued.set(sourceNode.identity, sourceNode);
            }
          }
        }
        for (const dependency of fileDependencies) {
          if (dependency.loader === "@jsxImportSource") continue;
          const result = classifyDependency(
            root,
            context,
            dependency,
            resolver,
            files,
            ownedPackageNames,
            selfResolutions,
            identity,
          );
          report.issues.push(...result.issues);
          for (const sourceNode of result.sourceNodes) {
            if (!visited.has(sourceNode.identity)) {
              queued.set(sourceNode.identity, sourceNode);
            }
          }
        }
      }
    };

    // First compute genuine per-target closure from manifest, runtime, and
    // applicable configuration roots only.
    for (const state of states) traverse(state);
    const globallyReached = new Set(
      states.flatMap((state) =>
        [...state.visited.values()].map((node) => node.path)
      ),
    );

    // Explicit source assignments are fallback ownership for files unreachable
    // from every declared root. They must not make target-only closure universal.
    for (const state of states) {
      for (const path of baselinePaths) {
        if (
          !globallyReached.has(path) &&
          state.context.assignedSource.some((assignment) =>
            path.startsWith(assignment.pathPrefix)
          )
        ) state.queued.set(path, { identity: path, path });
      }
      traverse(state);
    }
    report.issues = deduplicateIssues(report.issues);
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

export async function runStrictCoreDependencyAuditCli(
  args: string[],
  dependencies: StrictAuditDependencies = {},
): Promise<number> {
  let root: string;
  let output: string;
  try {
    ({ root, output } = parseArguments(args));
  } catch (error) {
    const recoveredOutput = recoverOutputPath(args);
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
        return 3;
      }
    }
    console.error(message);
    return 3;
  }

  const report = await runStrictCoreDependencyAudit(root, dependencies);
  try {
    await writeReportAtomically(output, report);
  } catch (error) {
    console.error(
      `report-write-failure: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return 3;
  }
  if (!report.evidenceComplete || report.operationalErrors.length > 0) {
    console.error(
      `Strict core dependency audit incomplete: ${report.operationalErrors.length} error(s).`,
    );
    return 3;
  }
  if (report.issues.length > 0) {
    console.error(
      `Strict core dependency audit found ${report.issues.length} policy issue(s).`,
    );
    return 2;
  }
  console.log(
    `Strict core dependency audit examined ${report.examined.files} files across ${report.examined.roots} contexts.`,
  );
  return 0;
}

if (import.meta.main) {
  Deno.exit(await runStrictCoreDependencyAuditCli(Deno.args));
}
