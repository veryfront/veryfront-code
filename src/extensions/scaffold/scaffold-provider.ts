/**
 * Dependency-free contract for project scaffold providers.
 *
 * Providers own engine-specific templates and package choices. Core owns the
 * project boundary, validates provider output, and writes the accepted plan.
 * A provider must return the same semantic catalog and plan for the same
 * request; runtime snapshots canonicalize collection order but cannot make a
 * stateful provider deterministic.
 *
 * @module extensions/scaffold/scaffold-provider
 */

/** Registry name used for the scaffold-provider extension contract. */
export const ScaffoldProviderName = "ScaffoldProvider" as const;

/** Only contract revision currently understood by core. */
export const SCAFFOLD_PROVIDER_API_VERSION = 1 as const;

/** Runtime selected for a generated project. */
export type ScaffoldRuntime = "bun" | "deno" | "node";

/** Immutable input supplied by core to a scaffold provider. */
export interface ScaffoldRequest {
  readonly frameworkVersion: string;
  readonly projectName: string;
  readonly runtime: ScaffoldRuntime;
  readonly templateId: string;
  readonly featureIds: readonly string[];
  readonly integrationIds: readonly string[];
}

/** One selectable template, feature, or integration. */
export interface ScaffoldCatalogEntry {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
}

/** Provider-owned choices presented by a scaffold UI or CLI. */
export interface ScaffoldCatalog {
  readonly templates: readonly ScaffoldCatalogEntry[];
  readonly features: readonly ScaffoldCatalogEntry[];
  readonly integrations: readonly ScaffoldCatalogEntry[];
}

/** A portable project-relative file emitted by a provider. */
export interface ScaffoldFile {
  readonly path: string;
  readonly content: string;
}

/** One package-manager dependency contribution. */
export interface ScaffoldPackageRecord {
  readonly name: string;
  readonly range: string;
}

/**
 * Package metadata contributed by a provider.
 *
 * Package names and ranges are data. Core does not choose or recognize
 * particular third-party packages. `firstPartyExtensions` lets composition
 * apply the framework version policy, while `trustedBuildPackages` names the
 * declared packages whose install-time build steps the provider requires.
 */
export interface ScaffoldPackageContribution {
  readonly dependencies: readonly ScaffoldPackageRecord[];
  readonly devDependencies: readonly ScaffoldPackageRecord[];
  readonly firstPartyExtensions: readonly string[];
  readonly trustedBuildPackages: readonly string[];
}

/** Environment variable required or supported by the generated project. */
export interface ScaffoldEnvironmentVariable {
  readonly name: string;
  readonly required: boolean;
  readonly description?: string;
}

/** Complete provider contribution, before core-owned files are composed. */
export interface ScaffoldPlan {
  readonly files: readonly ScaffoldFile[];
  readonly package: ScaffoldPackageContribution;
  readonly environment: readonly ScaffoldEnvironmentVariable[];
  readonly notices: readonly string[];
}

/**
 * Engine-neutral scaffold-provider contract.
 *
 * Runtime callers must capture providers with `captureScaffoldProvider` (or
 * snapshot each request and result explicitly) before trusting dynamic
 * extension values.
 */
export interface ScaffoldProvider {
  readonly id: string;
  readonly apiVersion: typeof SCAFFOLD_PROVIDER_API_VERSION;
  getCatalog(): ScaffoldCatalog | Promise<ScaffoldCatalog>;
  createPlan(request: ScaffoldRequest): ScaffoldPlan | Promise<ScaffoldPlan>;
}
