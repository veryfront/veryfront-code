import { fromFileUrl, join, toFileUrl } from "#std/path";

type Capability = { type: string; [key: string]: unknown };

interface ContractMetadata {
  provides?: string[];
  requires?: string[];
}

export interface ExtensionContractAuditInput {
  manifestPath: string;
  manifestCapabilities: Capability[];
  manifestContracts?: ContractMetadata;
  factoryProvides: string[];
  factoryRequires: string[];
}

export interface ExtensionContractAuditIssue {
  manifestPath: string;
  message: string;
}

type Importer = (moduleUrl: string) => Promise<Record<string, unknown>>;

interface ImportWithRetryOptions {
  retries?: number;
  delay?: (ms: number) => Promise<void>;
  importModule?: Importer;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTransientRemoteImportFailure(error: unknown): boolean {
  if (!(error instanceof TypeError)) return false;
  const message = error.message;
  if (!/Import ['"]https?:\/\//.test(message)) return false;
  return /\b(408|425|429|5\d\d)\b/.test(message) ||
    /network|connection|timeout|temporar/i.test(message);
}

export async function importWithRetry(
  moduleUrl: string,
  options: ImportWithRetryOptions = {},
): Promise<Record<string, unknown>> {
  const retries = options.retries ?? 2;
  const delay = options.delay ?? sleep;
  const importModule = options.importModule ?? ((url) => import(url));

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await importModule(moduleUrl);
    } catch (error) {
      if (attempt >= retries || !isTransientRemoteImportFailure(error)) {
        throw error;
      }
      await delay(250 * (attempt + 1));
    }
  }

  throw new Error(`Unable to import ${moduleUrl}`);
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].filter((value) => value.length > 0).sort();
}

function contractList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return uniqueSorted(
    value.filter((entry): entry is string =>
      typeof entry === "string" && entry.length > 0
    ),
  );
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

  for (const input of inputs) {
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

    const factoryProvides = uniqueSorted(input.factoryProvides);
    const factoryRequires = uniqueSorted(input.factoryRequires);
    const factoryContractSummary = describeContracts(
      factoryProvides,
      factoryRequires,
    );

    if (!input.manifestContracts && factoryContractSummary.length > 0) {
      issues.push({
        manifestPath: input.manifestPath,
        message:
          `${input.manifestPath} is missing veryfront.contracts for factory-declared contracts: ${factoryContractSummary}`,
      });
      continue;
    }

    const manifestProvides = contractList(input.manifestContracts?.provides);
    const manifestRequires = contractList(input.manifestContracts?.requires);

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

async function extensionManifestPaths(root: string): Promise<string[]> {
  const extensionsDir = join(root, "extensions");
  const paths: string[] = [];
  for await (const entry of Deno.readDir(extensionsDir)) {
    if (!entry.isDirectory || !entry.name.startsWith("ext-")) continue;
    paths.push(join("extensions", entry.name, "deno.json"));
  }
  return paths.sort();
}

async function loadAuditInput(
  root: string,
  manifestPath: string,
): Promise<ExtensionContractAuditInput> {
  const manifest = JSON.parse(
    await Deno.readTextFile(join(root, manifestPath)),
  ) as Record<string, unknown>;
  const veryfront = (manifest.veryfront ?? {}) as Record<string, unknown>;
  const moduleUrl = toFileUrl(
    join(root, manifestPath.replace(/deno\.json$/, "src/index.ts")),
  ).href;
  const mod = await importWithRetry(moduleUrl);
  if (typeof mod.default !== "function") {
    throw new Error(`${manifestPath} default export is not an extension factory`);
  }
  const extension = mod.default() as {
    contracts?: ContractMetadata;
    provides?: Record<string, unknown>;
  };

  return {
    manifestPath,
    manifestCapabilities: Array.isArray(veryfront.capabilities)
      ? veryfront.capabilities.filter((value): value is Capability =>
        value !== null && typeof value === "object" && !Array.isArray(value) &&
        typeof (value as Record<string, unknown>).type === "string"
      )
      : [],
    manifestContracts: veryfront.contracts as ContractMetadata | undefined,
    factoryProvides: uniqueSorted([
      ...Object.keys(extension.provides ?? {}),
      ...contractList(extension.contracts?.provides),
    ]),
    factoryRequires: contractList(extension.contracts?.requires),
  };
}

async function auditWorkspace(root: string): Promise<ExtensionContractAuditIssue[]> {
  const inputs = await Promise.all(
    (await extensionManifestPaths(root)).map((manifestPath) =>
      loadAuditInput(root, manifestPath)
    ),
  );
  return auditExtensionContracts(inputs);
}

if (import.meta.main) {
  const root = fromFileUrl(new URL("../..", import.meta.url));
  const issues = await auditWorkspace(root);
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
