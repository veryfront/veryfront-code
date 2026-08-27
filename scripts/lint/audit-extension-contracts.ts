import { dirname, fromFileUrl, join } from "#std/path";
import {
  containsUnicodeControlOrLineSeparator,
  isWellFormedUnicode,
  MAX_EXTENSION_CONTRACT_NAME_CHARACTERS,
  MAX_EXTENSION_CONTRACTS_PER_LIST,
  snapshotDenseMetadataArray,
} from "../../src/extensions/metadata-policy.ts";
import {
  createExtensionMetadataWorkspaceBudget,
  type ExtensionMetadataWorkspaceBudget,
  extractExtensionSourceMetadataFromFile,
} from "./extension-source-metadata.ts";
import {
  assertSupportedExtensionImportMap,
  canonicalExtensionManifestPath,
  createExtensionManifestWorkspaceBudget,
  discoverExtensionManifestPaths,
  ExtensionManifestReadError,
  type ExtensionManifestWorkspaceBudget,
  readExtensionManifest,
  resolveExtensionManifestEntry,
} from "./extension-manifest-reader.ts";

type Capability = { type: string; [key: string]: unknown };

export interface ExtensionContractAuditInput {
  manifestPath: string;
  manifestCapabilities: Capability[];
  manifestContracts?: unknown;
  factoryProvides: string[];
  factoryRequires: string[];
  sourceResolutionIssues?: string[];
}

export interface ExtensionContractAuditIssue {
  manifestPath: string;
  message: string;
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].filter((value) => value.length > 0).sort(
    compareDeterministically,
  );
}

function compareDeterministically(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

interface ValidatedContractList {
  values: string[];
  issues: string[];
}

function validateContractList(
  field: string,
  value: unknown,
): ValidatedContractList {
  if (value === undefined) return { values: [], issues: [] };
  let entries: readonly unknown[];
  try {
    entries = snapshotDenseMetadataArray(
      value,
      field,
      0,
      MAX_EXTENSION_CONTRACTS_PER_LIST,
    );
  } catch (error) {
    return {
      values: [],
      issues: [error instanceof Error ? error.message : `${field} is invalid`],
    };
  }
  const values: string[] = [];
  const issues: string[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    if (typeof entry !== "string" || entry.trim().length === 0) {
      issues.push(`${field}[${index}] must be a non-empty string`);
    } else if (entry.trim() !== entry) {
      issues.push(`${field}[${index}] must not have surrounding whitespace`);
    } else if (!isWellFormedUnicode(entry)) {
      issues.push(`${field}[${index}] must contain well-formed Unicode`);
    } else if (containsUnicodeControlOrLineSeparator(entry)) {
      issues.push(
        `${field}[${index}] must not contain Unicode control characters or line separators`,
      );
    } else if (entry.length > MAX_EXTENSION_CONTRACT_NAME_CHARACTERS) {
      issues.push(
        `${field}[${index}] must not exceed ${MAX_EXTENSION_CONTRACT_NAME_CHARACTERS} characters`,
      );
    } else if (seen.has(entry)) {
      issues.push(`${field}[${index}] duplicates "${entry}"`);
    } else {
      seen.add(entry);
      values.push(entry);
    }
  }
  return { values: values.toSorted(compareDeterministically), issues };
}

function describeContracts(
  provides: string[],
  requires: string[],
): string {
  const parts: string[] = [];
  if (provides.length > 0) parts.push(`provides ${provides.join(", ")}`);
  if (requires.length > 0) parts.push(`requires ${requires.join(", ")}`);
  return parts.join("; ");
}

function listsEqual(left: string[], right: string[]): boolean {
  return left.length === right.length &&
    left.every((value, index) => value === right[index]);
}

export function auditExtensionContracts(
  inputs: ExtensionContractAuditInput[],
): ExtensionContractAuditIssue[] {
  const issues: ExtensionContractAuditIssue[] = [];

  for (const rawInput of inputs) {
    const input = {
      ...rawInput,
      manifestPath: canonicalExtensionManifestPath(rawInput.manifestPath),
    };
    if (
      input.manifestCapabilities.some((capability) =>
        capability.type === "contract"
      )
    ) {
      issues.push({
        manifestPath: input.manifestPath,
        message:
          `${input.manifestPath} must not use capability type "contract"; use veryfront.contracts instead`,
      });
    }

    const factoryProvidesResult = validateContractList(
      "factory contracts.provides",
      input.factoryProvides,
    );
    const factoryRequiresResult = validateContractList(
      "factory contracts.requires",
      input.factoryRequires,
    );
    const sourceResolutionIssues = uniqueSorted(
      input.sourceResolutionIssues ?? [],
    );
    if (sourceResolutionIssues.length > 0) {
      for (const issue of sourceResolutionIssues) {
        issues.push({
          manifestPath: input.manifestPath,
          message:
            `${input.manifestPath} could not resolve factory contract metadata: ${issue}`,
        });
      }
      continue;
    }
    const factoryValidationIssues = [
      ...factoryProvidesResult.issues,
      ...factoryRequiresResult.issues,
    ];
    for (const issue of factoryValidationIssues) {
      issues.push({
        manifestPath: input.manifestPath,
        message: `${input.manifestPath} ${issue}`,
      });
    }
    if (factoryValidationIssues.length > 0) continue;
    const factoryProvides = factoryProvidesResult.values;
    const factoryRequires = factoryRequiresResult.values;
    const factoryContractSummary = describeContracts(
      factoryProvides,
      factoryRequires,
    );

    if (
      input.manifestContracts === undefined && factoryContractSummary.length > 0
    ) {
      issues.push({
        manifestPath: input.manifestPath,
        message:
          `${input.manifestPath} is missing veryfront.contracts for factory-declared contracts: ${factoryContractSummary}`,
      });
      continue;
    }

    if (
      input.manifestContracts !== undefined &&
      !isRecord(input.manifestContracts)
    ) {
      issues.push({
        manifestPath: input.manifestPath,
        message: `${input.manifestPath} veryfront.contracts must be an object`,
      });
      continue;
    }
    const manifestContracts = isRecord(input.manifestContracts)
      ? input.manifestContracts
      : undefined;

    const manifestProvidesResult = validateContractList(
      "veryfront.contracts.provides",
      manifestContracts?.provides,
    );
    const manifestRequiresResult = validateContractList(
      "veryfront.contracts.requires",
      manifestContracts?.requires,
    );
    const manifestValidationIssues = [
      ...manifestProvidesResult.issues,
      ...manifestRequiresResult.issues,
    ];
    for (const issue of manifestValidationIssues) {
      issues.push({
        manifestPath: input.manifestPath,
        message: `${input.manifestPath} ${issue}`,
      });
    }
    if (manifestValidationIssues.length > 0) continue;
    const manifestProvides = manifestProvidesResult.values;
    const manifestRequires = manifestRequiresResult.values;

    if (!listsEqual(manifestProvides, factoryProvides)) {
      issues.push({
        manifestPath: input.manifestPath,
        message:
          `${input.manifestPath} veryfront.contracts.provides differs from factory contracts: manifest ${
            manifestProvides.join(", ") || "none"
          }; factory ${factoryProvides.join(", ") || "none"}`,
      });
    }

    if (!listsEqual(manifestRequires, factoryRequires)) {
      issues.push({
        manifestPath: input.manifestPath,
        message:
          `${input.manifestPath} veryfront.contracts.requires differs from factory contracts: manifest ${
            manifestRequires.join(", ") || "none"
          }; factory ${factoryRequires.join(", ") || "none"}`,
      });
    }
  }

  return issues;
}

async function loadAuditInput(
  root: string,
  manifestPath: string,
  workspaceBudget: ExtensionMetadataWorkspaceBudget,
  manifestBudget: ExtensionManifestWorkspaceBudget,
): Promise<ExtensionContractAuditInput> {
  const manifest = await readExtensionManifest(
    root,
    manifestPath,
    manifestBudget,
  );
  const veryfront = isRecord(manifest.veryfront) ? manifest.veryfront : {};
  const imports = manifest.imports;
  assertSupportedExtensionImportMap(manifestPath, manifest);
  const entryPath = resolveExtensionManifestEntry(manifestPath, manifest);
  let factoryProvides: string[] = [];
  let factoryRequires: string[] = [];
  let sourceResolutionIssues: string[] = [];
  try {
    const sourceMetadata = await extractExtensionSourceMetadataFromFile({
      workspaceRoot: root,
      entryPath: join(
        root,
        entryPath,
      ),
      importMapBaseDir: join(root, dirname(manifestPath)),
      imports: typeof imports === "object" && imports !== null &&
          !Array.isArray(imports)
        ? imports as Record<string, unknown>
        : {},
      workspaceBudget,
    });
    factoryProvides = uniqueSorted([
      ...sourceMetadata.legacyProvides,
      ...validateContractList(
        "source contracts.provides",
        sourceMetadata.contracts?.provides,
      ).values,
    ]);
    factoryRequires = validateContractList(
      "source contracts.requires",
      sourceMetadata.contracts?.requires,
    ).values;
    sourceResolutionIssues = sourceMetadata.contractResolutionIssues;
  } catch (error) {
    sourceResolutionIssues = [
      `[source-inspection-failed] ${
        error instanceof Error ? error.message : "unknown failure"
      }`,
    ];
  }

  return {
    manifestPath,
    manifestCapabilities: Array.isArray(veryfront.capabilities)
      ? veryfront.capabilities.filter((value): value is Capability =>
        value !== null && typeof value === "object" && !Array.isArray(value) &&
        typeof (value as Record<string, unknown>).type === "string"
      )
      : [],
    manifestContracts: veryfront.contracts,
    factoryProvides,
    factoryRequires,
    sourceResolutionIssues,
  };
}

export async function auditExtensionContractWorkspace(
  root: string,
): Promise<ExtensionContractAuditIssue[]> {
  const discovery = await discoverExtensionManifestPaths(root);
  const workspaceBudget = createExtensionMetadataWorkspaceBudget();
  const manifestBudget = createExtensionManifestWorkspaceBudget();
  const loaded: Array<
    ExtensionContractAuditInput | ExtensionContractAuditIssue
  > = [];
  for (const manifestPath of discovery.manifestPaths) {
    try {
      loaded.push(
        await loadAuditInput(
          root,
          manifestPath,
          workspaceBudget,
          manifestBudget,
        ),
      );
    } catch (error) {
      const detail = error instanceof ExtensionManifestReadError
        ? error.message
        : "[manifest-read-failed] manifest could not be inspected";
      loaded.push({
        manifestPath,
        message: `${manifestPath} could not read extension manifest: ${detail}`,
      });
    }
  }
  const inputs: ExtensionContractAuditInput[] = [];
  const issues: ExtensionContractAuditIssue[] = discovery.issues.map((
    issue,
  ) => ({
    manifestPath: issue.manifestPath,
    message:
      `${issue.manifestPath} could not discover extension manifest: ${issue.detail}`,
  }));
  for (const entry of loaded) {
    if ("factoryProvides" in entry) inputs.push(entry);
    else issues.push(entry);
  }
  return [...issues, ...auditExtensionContracts(inputs)].sort((left, right) =>
    compareDeterministically(left.message, right.message)
  );
}

if (import.meta.main) {
  const root = fromFileUrl(new URL("../..", import.meta.url));
  const issues = await auditExtensionContractWorkspace(root);
  if (issues.length === 0) {
    console.log("Extension contract metadata verified.");
    Deno.exit(0);
  }

  console.error(`${issues.length} extension contract issue(s):`);
  for (const issue of issues) {
    console.error(`  ${issue.message}`);
  }
  Deno.exit(1);
}
