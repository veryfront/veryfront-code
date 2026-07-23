import { validateVeryfrontConfig, type VeryfrontConfig } from "#veryfront/config/schemas/index.ts";
import { createProjectDiscoveryConfig } from "#veryfront/discovery/project-discovery-config.ts";
import {
  normalizeSourceIntegrationPolicy,
  parseSourceIntegrationPolicyManifest,
  type SourceIntegrationPolicyManifest,
} from "#veryfront/integrations/source-policy.ts";
import { createStyleScopeProfile } from "#veryfront/html/styles-builder/style-scope-profile.ts";
import {
  runWithSharedRegistryMutationsDisabled,
} from "#veryfront/registry/project-scoped-registry-manager.ts";
import { ensureBuiltinSchemaValidator } from "#veryfront/extensions/builtin-extensions.ts";
import {
  assertValidProjectConfigModule,
  type ProjectConfigModule,
} from "./project-config-module.ts";
import { normalizeProjectSourcePath } from "./project-source-snapshot.ts";

const STYLE_PROFILE_HASH_PATTERN = /^[0-9a-f]{16}$/;
const MAX_CONFIG_PATHS = 128;
const RENDER_VERSION_PATTERN = /^[A-Za-z0-9~^*<>=][A-Za-z0-9._+~^*<>=|-]{0,127}$/;
const MAX_RENDER_DIRECTORY_COMPONENTS = 128;
const MAX_RENDER_DEV_COMPONENTS = 1_000;
const MAX_RENDER_QUERY_PARAMS = 256;
const MAX_RENDER_QUERY_PARAM_LENGTH = 1_024;
const MAX_RENDER_BUNDLE_MANIFEST_TTL_MS = 365 * 24 * 60 * 60 * 1_000;
const renderProjectionEncoder = new TextEncoder();

export const RENDER_PROJECT_CONFIG_MAX_ENCODED_BYTES = 1024 * 1024;

export interface AgentProjectConfigProjection {
  agentDirs: string[];
  toolDirs: string[];
  skillDirs: string[];
  sourceIntegrationPolicy: SourceIntegrationPolicyManifest;
}

export interface StyleProjectConfigProjection {
  stylesheetPath?: string;
  styleProfile: {
    hash: string;
    ignoredRoots: string[];
    protectedRoots: string[];
    protectedPaths: string[];
  };
}

export interface RenderProjectConfigProjection {
  readonly router?: "app" | "pages";
  readonly directories?: {
    readonly app?: string;
    readonly pages?: string;
    readonly components?: readonly string[];
  };
  readonly layout?: string | false;
  readonly app?: string | false;
  readonly experimental?: {
    readonly esmLayouts?: boolean;
  };
  readonly react?: {
    readonly version?: string;
  };
  readonly client?: {
    readonly moduleResolution?: "cdn" | "self-hosted" | "bundled";
    readonly cdn?: {
      readonly provider?: "esm.sh" | "unpkg" | "jsdelivr";
      readonly versions?: "auto" | {
        readonly react?: string;
        readonly veryfront?: string;
      };
    };
  };
  readonly cache?: {
    readonly bundleManifest?: {
      readonly ttl?: number;
    };
    readonly queryParams?: {
      readonly policy?: "ignore-all" | "include-all" | "include-list" | "exclude-list";
      readonly params?: readonly string[];
    };
  };
  readonly dev?: {
    readonly port?: number;
    readonly hmr?: boolean;
    readonly components?: readonly string[];
  };
  readonly tailwind?: {
    readonly stylesheet?: string;
  };
}

function assertDedicatedWorkerRealm(): void {
  const scopeConstructor = Reflect.get(globalThis, "DedicatedWorkerGlobalScope") as
    | (new (...args: never[]) => object)
    | undefined;
  if (
    typeof scopeConstructor !== "function" ||
    !(globalThis instanceof scopeConstructor)
  ) {
    throw new TypeError("Project config evaluation requires a dedicated Worker realm");
  }
}

function readConfigModuleExport(module: Record<string, unknown>): unknown {
  return Object.prototype.hasOwnProperty.call(module, "default") ? module.default : module;
}

/** Evaluate a prepared project config only after entering a dedicated Worker realm. */
export async function evaluateProjectConfigModuleInWorker(
  module: ProjectConfigModule | undefined,
): Promise<VeryfrontConfig> {
  assertDedicatedWorkerRealm();
  ensureBuiltinSchemaValidator();
  if (!module) return validateVeryfrontConfig({});
  assertValidProjectConfigModule(module);

  const moduleUrl = URL.createObjectURL(
    new Blob([module.moduleCode], { type: "text/javascript" }),
  );
  try {
    const namespace = await runWithSharedRegistryMutationsDisabled(
      () => import(moduleUrl) as Promise<Record<string, unknown>>,
    );
    return validateVeryfrontConfig(readConfigModuleExport(namespace));
  } finally {
    URL.revokeObjectURL(moduleUrl);
  }
}

function assertCanonicalPath(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string") throw new TypeError(`${label} is invalid`);
  const normalized = normalizeProjectSourcePath(value, "/", true);
  if (normalized !== value) throw new TypeError(`${label} must be project-relative and canonical`);
}

function snapshotDiscoveryDirs(value: readonly string[], label: string): string[] {
  if (!Array.isArray(value) || value.length > 64) {
    throw new RangeError(`${label} count exceeds the supported limit`);
  }
  const result: string[] = [];
  const seen = new Set<string>();
  for (const path of value) {
    assertCanonicalPath(path, label);
    if (seen.has(path)) throw new TypeError(`${label} contains a duplicate path`);
    seen.add(path);
    result.push(path);
  }
  return result;
}

/** Build the only config fields needed to discover and authorize an agent run. */
export function createAgentProjectConfigProjection(
  config: VeryfrontConfig,
): AgentProjectConfigProjection {
  const discovery = createProjectDiscoveryConfig({ projectDir: "", config });
  const result: AgentProjectConfigProjection = {
    agentDirs: snapshotDiscoveryDirs(discovery.agentDirs, "Agent discovery directory"),
    toolDirs: snapshotDiscoveryDirs(discovery.toolDirs, "Tool discovery directory"),
    skillDirs: snapshotDiscoveryDirs(discovery.skillDirs, "Skill discovery directory"),
    sourceIntegrationPolicy: normalizeSourceIntegrationPolicy(config.integrations),
  };
  assertValidAgentProjectConfigProjection(result);
  return result;
}

export function assertValidAgentProjectConfigProjection(
  value: AgentProjectConfigProjection,
): asserts value is AgentProjectConfigProjection {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Agent project config projection is invalid");
  }
  snapshotDiscoveryDirs(value.agentDirs, "Agent discovery directory");
  snapshotDiscoveryDirs(value.toolDirs, "Tool discovery directory");
  snapshotDiscoveryDirs(value.skillDirs, "Skill discovery directory");
  parseSourceIntegrationPolicyManifest(value.sourceIntegrationPolicy);
}

function assertOptionalStyleConfigPath(value: unknown, label: string): void {
  if (value === undefined) return;
  assertCanonicalPath(value, label);
}

function validateStyleInputs(config: VeryfrontConfig): void {
  assertOptionalStyleConfigPath(config.directories?.app, "Style app directory");
  assertOptionalStyleConfigPath(config.directories?.pages, "Style pages directory");
  const components = config.directories?.components ?? [];
  if (!Array.isArray(components) || components.length > MAX_CONFIG_PATHS) {
    throw new RangeError("Style component directory count exceeds the supported limit");
  }
  for (const component of components) {
    assertCanonicalPath(component, "Style component directory");
  }
  if (typeof config.layout === "string") {
    assertCanonicalPath(config.layout, "Style layout path");
  }
  if (typeof config.app === "string") {
    assertCanonicalPath(config.app, "Style app path");
  }
  assertOptionalStyleConfigPath(config.tailwind?.stylesheet, "Style stylesheet path");
}

function snapshotStylePaths(value: readonly string[], label: string): string[] {
  if (!Array.isArray(value) || value.length > MAX_CONFIG_PATHS) {
    throw new RangeError(`${label} count exceeds the supported limit`);
  }
  const result: string[] = [];
  let previous: string | undefined;
  for (const path of value) {
    assertCanonicalPath(path, label);
    if (previous !== undefined && path <= previous) {
      throw new TypeError(`${label} must be unique and sorted`);
    }
    previous = path;
    result.push(path);
  }
  return result;
}

/** Build the exact, secret-free config projection consumed by style pre-generation. */
export function createStyleProjectConfigProjection(
  config: VeryfrontConfig,
): StyleProjectConfigProjection {
  validateStyleInputs(config);
  const profile = createStyleScopeProfile(config);
  const result: StyleProjectConfigProjection = {
    ...(config.tailwind?.stylesheet === undefined
      ? {}
      : { stylesheetPath: config.tailwind.stylesheet }),
    styleProfile: {
      hash: profile.hash,
      ignoredRoots: [...profile.ignoredRoots],
      protectedRoots: [...profile.protectedRoots],
      protectedPaths: [...profile.protectedPaths],
    },
  };
  assertValidStyleProjectConfigProjection(result);
  return result;
}

export function assertValidStyleProjectConfigProjection(
  value: StyleProjectConfigProjection,
): asserts value is StyleProjectConfigProjection {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Style project config projection is invalid");
  }
  assertOptionalStyleConfigPath(value.stylesheetPath, "Style stylesheet path");
  const profile = value.styleProfile;
  if (!profile || typeof profile !== "object" || Array.isArray(profile)) {
    throw new TypeError("Style project config profile is invalid");
  }
  if (!STYLE_PROFILE_HASH_PATTERN.test(profile.hash)) {
    throw new TypeError("Style project config profile hash is invalid");
  }
  snapshotStylePaths(profile.ignoredRoots, "Style ignored root");
  snapshotStylePaths(profile.protectedRoots, "Style protected root");
  snapshotStylePaths(profile.protectedPaths, "Style protected path");
}

type StrictObjectValues = Record<string, unknown>;

function hasOwn(value: StrictObjectValues, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function containsUnsafeRenderStringCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) return true;
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!Number.isInteger(next) || next < 0xdc00 || next > 0xdfff) return true;
      index++;
      continue;
    }
    if (code >= 0xdc00 && code <= 0xdfff) return true;
  }
  return false;
}

function parseStrictObject<T>(
  value: unknown,
  label: string,
  allowedKeys: readonly string[],
  active: WeakSet<object>,
  parse: (values: StrictObjectValues) => T,
): T {
  if (
    !value || typeof value !== "object" || Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw new TypeError(`${label} must be a plain object`);
  }
  if (active.has(value)) throw new TypeError(`${label} must not contain a cycle`);

  const keys = Reflect.ownKeys(value);
  const allowed = new Set(allowedKeys);
  const values: StrictObjectValues = Object.create(null);
  for (const key of keys) {
    if (typeof key !== "string" || !allowed.has(key)) {
      throw new TypeError(`${label} contains an unknown own key`);
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
      throw new TypeError(`${label} must contain only enumerable data properties`);
    }
    if (descriptor.value === undefined) {
      throw new TypeError(`${label}.${key} must be omitted instead of undefined`);
    }
    Object.defineProperty(values, key, {
      configurable: false,
      enumerable: true,
      value: descriptor.value,
      writable: false,
    });
  }

  active.add(value);
  try {
    return parse(values);
  } finally {
    active.delete(value);
  }
}

function parseStrictArray<T>(
  value: unknown,
  label: string,
  maxItems: number,
  active: WeakSet<object>,
  parseItem: (item: unknown, index: number) => T,
): readonly T[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
    throw new TypeError(`${label} must be a plain array`);
  }
  if (value.length > maxItems) throw new RangeError(`${label} exceeds the entry limit`);
  if (active.has(value)) throw new TypeError(`${label} must not contain a cycle`);

  const keys = Reflect.ownKeys(value);
  if (keys.length !== value.length + 1 || !keys.includes("length")) {
    throw new TypeError(`${label} must be dense and contain no extra own keys`);
  }
  for (const key of keys) {
    if (typeof key !== "string") {
      throw new TypeError(`${label} must not contain symbol keys`);
    }
    if (key === "length") continue;
    const index = Number(key);
    if (
      !Number.isSafeInteger(index) || index < 0 || index >= value.length || String(index) !== key
    ) {
      throw new TypeError(`${label} must be dense and contain no extra own keys`);
    }
  }

  active.add(value);
  try {
    const result: T[] = [];
    for (let index = 0; index < value.length; index++) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
        throw new TypeError(`${label} must contain only enumerable data items`);
      }
      result.push(parseItem(descriptor.value, index));
    }
    return Object.freeze(result);
  } finally {
    active.delete(value);
  }
}

function requireNonEmptyObject(values: StrictObjectValues, label: string): void {
  if (Object.keys(values).length === 0) {
    throw new TypeError(`${label} must be omitted when empty`);
  }
}

function parseRenderPath(value: unknown, label: string): string {
  if (typeof value !== "string" || containsUnsafeRenderStringCharacter(value)) {
    throw new TypeError(`${label} is invalid`);
  }
  const normalized = normalizeProjectSourcePath(value, "/", true);
  if (normalized !== value) {
    throw new TypeError(`${label} must be project-relative and canonical`);
  }
  return value;
}

function parseRenderVersion(value: unknown, label: string): string {
  if (typeof value !== "string" || !RENDER_VERSION_PATTERN.test(value)) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}

function parseEnum<const T extends string>(
  value: unknown,
  allowed: readonly T[],
  label: string,
): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw new TypeError(`${label} is invalid`);
  }
  return value as T;
}

function parseBoolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") throw new TypeError(`${label} is invalid`);
  return value;
}

function parseRenderDirectories(
  value: unknown,
  active: WeakSet<object>,
): NonNullable<RenderProjectConfigProjection["directories"]> {
  return parseStrictObject(
    value,
    "Render directories config",
    ["app", "pages", "components"],
    active,
    (values) => {
      requireNonEmptyObject(values, "Render directories config");
      const result: {
        app?: string;
        pages?: string;
        components?: readonly string[];
      } = {};
      if (hasOwn(values, "app")) {
        result.app = parseRenderPath(values.app, "Render app directory");
      }
      if (hasOwn(values, "pages")) {
        result.pages = parseRenderPath(values.pages, "Render pages directory");
      }
      if (hasOwn(values, "components")) {
        result.components = parseStrictArray(
          values.components,
          "Render component directories",
          MAX_RENDER_DIRECTORY_COMPONENTS,
          active,
          (item) => parseRenderPath(item, "Render component directory"),
        );
      }
      return Object.freeze(result);
    },
  );
}

function parseOptionalRenderPathOrFalse(value: unknown, label: string): string | false {
  return value === false ? false : parseRenderPath(value, label);
}

function parseRenderExperimental(
  value: unknown,
  active: WeakSet<object>,
): NonNullable<RenderProjectConfigProjection["experimental"]> {
  return parseStrictObject(
    value,
    "Render experimental config",
    ["esmLayouts"],
    active,
    (values) => {
      requireNonEmptyObject(values, "Render experimental config");
      return Object.freeze({
        esmLayouts: parseBoolean(values.esmLayouts, "Render esmLayouts config"),
      });
    },
  );
}

function parseRenderReact(
  value: unknown,
  active: WeakSet<object>,
): NonNullable<RenderProjectConfigProjection["react"]> {
  return parseStrictObject(value, "Render React config", ["version"], active, (values) => {
    requireNonEmptyObject(values, "Render React config");
    return Object.freeze({
      version: parseRenderVersion(values.version, "Render React version"),
    });
  });
}

function parseRenderCdnVersions(
  value: unknown,
  active: WeakSet<object>,
): NonNullable<
  NonNullable<NonNullable<RenderProjectConfigProjection["client"]>["cdn"]>["versions"]
> {
  if (value === "auto") return value;
  return parseStrictObject(
    value,
    "Render client CDN versions",
    ["react", "veryfront"],
    active,
    (values) => {
      requireNonEmptyObject(values, "Render client CDN versions");
      const result: { react?: string; veryfront?: string } = {};
      if (hasOwn(values, "react")) {
        result.react = parseRenderVersion(values.react, "Render client CDN React version");
      }
      if (hasOwn(values, "veryfront")) {
        result.veryfront = parseRenderVersion(
          values.veryfront,
          "Render client CDN Veryfront version",
        );
      }
      return Object.freeze(result);
    },
  );
}

function parseRenderCdn(
  value: unknown,
  active: WeakSet<object>,
): NonNullable<NonNullable<RenderProjectConfigProjection["client"]>["cdn"]> {
  return parseStrictObject(
    value,
    "Render client CDN config",
    ["provider", "versions"],
    active,
    (values) => {
      requireNonEmptyObject(values, "Render client CDN config");
      const result: {
        provider?: "esm.sh" | "unpkg" | "jsdelivr";
        versions?: "auto" | { readonly react?: string; readonly veryfront?: string };
      } = {};
      if (hasOwn(values, "provider")) {
        result.provider = parseEnum(
          values.provider,
          ["esm.sh", "unpkg", "jsdelivr"],
          "Render client CDN provider",
        );
      }
      if (hasOwn(values, "versions")) {
        result.versions = parseRenderCdnVersions(values.versions, active);
      }
      return Object.freeze(result);
    },
  );
}

function parseRenderClient(
  value: unknown,
  active: WeakSet<object>,
): NonNullable<RenderProjectConfigProjection["client"]> {
  return parseStrictObject(
    value,
    "Render client config",
    ["moduleResolution", "cdn"],
    active,
    (values) => {
      requireNonEmptyObject(values, "Render client config");
      const result: {
        moduleResolution?: "cdn" | "self-hosted" | "bundled";
        cdn?: NonNullable<NonNullable<RenderProjectConfigProjection["client"]>["cdn"]>;
      } = {};
      if (hasOwn(values, "moduleResolution")) {
        result.moduleResolution = parseEnum(
          values.moduleResolution,
          ["cdn", "self-hosted", "bundled"],
          "Render client module resolution",
        );
      }
      if (hasOwn(values, "cdn")) result.cdn = parseRenderCdn(values.cdn, active);
      return Object.freeze(result);
    },
  );
}

function parseRenderBundleManifest(
  value: unknown,
  active: WeakSet<object>,
): NonNullable<NonNullable<RenderProjectConfigProjection["cache"]>["bundleManifest"]> {
  return parseStrictObject(
    value,
    "Render bundle manifest config",
    ["ttl"],
    active,
    (values) => {
      requireNonEmptyObject(values, "Render bundle manifest config");
      const ttl = values.ttl;
      if (
        typeof ttl !== "number" || !Number.isSafeInteger(ttl) || ttl <= 0 ||
        ttl > MAX_RENDER_BUNDLE_MANIFEST_TTL_MS
      ) {
        throw new RangeError("Render bundle manifest TTL is invalid");
      }
      return Object.freeze({ ttl });
    },
  );
}

function parseRenderQueryParam(value: unknown, label: string): string {
  if (
    typeof value !== "string" || value.length > MAX_RENDER_QUERY_PARAM_LENGTH ||
    containsUnsafeRenderStringCharacter(value)
  ) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}

function parseRenderQueryParams(
  value: unknown,
  active: WeakSet<object>,
): NonNullable<NonNullable<RenderProjectConfigProjection["cache"]>["queryParams"]> {
  return parseStrictObject(
    value,
    "Render query parameter config",
    ["policy", "params"],
    active,
    (values) => {
      requireNonEmptyObject(values, "Render query parameter config");
      const result: {
        policy?: "ignore-all" | "include-all" | "include-list" | "exclude-list";
        params?: readonly string[];
      } = {};
      if (hasOwn(values, "policy")) {
        result.policy = parseEnum(
          values.policy,
          ["ignore-all", "include-all", "include-list", "exclude-list"],
          "Render query parameter policy",
        );
      }
      if (hasOwn(values, "params")) {
        result.params = parseStrictArray(
          values.params,
          "Render query parameter list",
          MAX_RENDER_QUERY_PARAMS,
          active,
          (item, index) => parseRenderQueryParam(item, `Render query parameter ${index}`),
        );
      }
      return Object.freeze(result);
    },
  );
}

function parseRenderCache(
  value: unknown,
  active: WeakSet<object>,
): NonNullable<RenderProjectConfigProjection["cache"]> {
  return parseStrictObject(
    value,
    "Render cache config",
    ["bundleManifest", "queryParams"],
    active,
    (values) => {
      requireNonEmptyObject(values, "Render cache config");
      const result: {
        bundleManifest?: NonNullable<
          NonNullable<RenderProjectConfigProjection["cache"]>["bundleManifest"]
        >;
        queryParams?: NonNullable<
          NonNullable<RenderProjectConfigProjection["cache"]>["queryParams"]
        >;
      } = {};
      if (hasOwn(values, "bundleManifest")) {
        result.bundleManifest = parseRenderBundleManifest(values.bundleManifest, active);
      }
      if (hasOwn(values, "queryParams")) {
        result.queryParams = parseRenderQueryParams(values.queryParams, active);
      }
      return Object.freeze(result);
    },
  );
}

function parseRenderDev(
  value: unknown,
  active: WeakSet<object>,
): NonNullable<RenderProjectConfigProjection["dev"]> {
  return parseStrictObject(
    value,
    "Render development config",
    ["port", "hmr", "components"],
    active,
    (values) => {
      requireNonEmptyObject(values, "Render development config");
      const result: { port?: number; hmr?: boolean; components?: readonly string[] } = {};
      if (hasOwn(values, "port")) {
        if (
          typeof values.port !== "number" || !Number.isSafeInteger(values.port) ||
          values.port < 1 || values.port > 65_535
        ) {
          throw new RangeError("Render development port is invalid");
        }
        result.port = values.port;
      }
      if (hasOwn(values, "hmr")) {
        result.hmr = parseBoolean(values.hmr, "Render development HMR config");
      }
      if (hasOwn(values, "components")) {
        result.components = parseStrictArray(
          values.components,
          "Render development components",
          MAX_RENDER_DEV_COMPONENTS,
          active,
          (item) => parseRenderPath(item, "Render development component"),
        );
      }
      return Object.freeze(result);
    },
  );
}

function parseRenderTailwind(
  value: unknown,
  active: WeakSet<object>,
): NonNullable<RenderProjectConfigProjection["tailwind"]> {
  return parseStrictObject(
    value,
    "Render Tailwind config",
    ["stylesheet"],
    active,
    (values) => {
      requireNonEmptyObject(values, "Render Tailwind config");
      return Object.freeze({
        stylesheet: parseRenderPath(values.stylesheet, "Render Tailwind stylesheet"),
      });
    },
  );
}

function selectedObject(
  entries: readonly (readonly [string, unknown])[],
): Record<string, unknown> | undefined {
  const result: Record<string, unknown> = {};
  for (const [key, value] of entries) {
    if (value !== undefined) result[key] = value;
  }
  return Object.keys(result).length === 0 ? undefined : result;
}

function createRenderProjectionCandidate(config: VeryfrontConfig): Record<string, unknown> {
  const cdnVersions = config.client?.cdn?.versions;
  const selectedCdnVersions = cdnVersions === "auto"
    ? "auto"
    : cdnVersions === undefined
    ? undefined
    : selectedObject([
      ["react", cdnVersions.react],
      ["veryfront", cdnVersions.veryfront],
    ]);
  const selectedCdn = selectedObject([
    ["provider", config.client?.cdn?.provider],
    ["versions", selectedCdnVersions],
  ]);

  const candidate = selectedObject([
    ["router", config.router],
    [
      "directories",
      selectedObject([
        ["app", config.directories?.app],
        ["pages", config.directories?.pages],
        ["components", config.directories?.components],
      ]),
    ],
    ["layout", config.layout],
    ["app", config.app],
    [
      "experimental",
      selectedObject([
        ["esmLayouts", config.experimental?.esmLayouts],
      ]),
    ],
    [
      "react",
      selectedObject([
        ["version", config.react?.version],
      ]),
    ],
    [
      "client",
      selectedObject([
        ["moduleResolution", config.client?.moduleResolution],
        ["cdn", selectedCdn],
      ]),
    ],
    [
      "cache",
      selectedObject([
        [
          "bundleManifest",
          selectedObject([
            ["ttl", config.cache?.bundleManifest?.ttl],
          ]),
        ],
        [
          "queryParams",
          selectedObject([
            ["policy", config.cache?.queryParams?.policy],
            ["params", config.cache?.queryParams?.params],
          ]),
        ],
      ]),
    ],
    [
      "dev",
      selectedObject([
        ["port", config.dev?.port],
        ["hmr", config.dev?.hmr],
        ["components", config.dev?.components],
      ]),
    ],
    [
      "tailwind",
      selectedObject([
        ["stylesheet", config.tailwind?.stylesheet],
      ]),
    ],
  ]);
  return candidate ?? {};
}

/** Build the exact, secret-free config subset consumed by remote rendering. */
export function createRenderProjectConfigProjection(
  config: VeryfrontConfig,
): RenderProjectConfigProjection {
  return parseRenderProjectConfigProjection(createRenderProjectionCandidate(config));
}

/**
 * Validate a render projection as canonical plain data and return an isolated,
 * recursively frozen copy suitable for a trusted host boundary.
 */
export function parseRenderProjectConfigProjection(
  value: unknown,
): RenderProjectConfigProjection {
  const active = new WeakSet<object>();
  const projection = parseStrictObject(
    value,
    "Render project config projection",
    [
      "router",
      "directories",
      "layout",
      "app",
      "experimental",
      "react",
      "client",
      "cache",
      "dev",
      "tailwind",
    ],
    active,
    (values) => {
      const result: {
        router?: "app" | "pages";
        directories?: NonNullable<RenderProjectConfigProjection["directories"]>;
        layout?: string | false;
        app?: string | false;
        experimental?: NonNullable<RenderProjectConfigProjection["experimental"]>;
        react?: NonNullable<RenderProjectConfigProjection["react"]>;
        client?: NonNullable<RenderProjectConfigProjection["client"]>;
        cache?: NonNullable<RenderProjectConfigProjection["cache"]>;
        dev?: NonNullable<RenderProjectConfigProjection["dev"]>;
        tailwind?: NonNullable<RenderProjectConfigProjection["tailwind"]>;
      } = {};
      if (hasOwn(values, "router")) {
        result.router = parseEnum(values.router, ["app", "pages"], "Render router config");
      }
      if (hasOwn(values, "directories")) {
        result.directories = parseRenderDirectories(values.directories, active);
      }
      if (hasOwn(values, "layout")) {
        result.layout = parseOptionalRenderPathOrFalse(values.layout, "Render layout path");
      }
      if (hasOwn(values, "app")) {
        result.app = parseOptionalRenderPathOrFalse(values.app, "Render app path");
      }
      if (hasOwn(values, "experimental")) {
        result.experimental = parseRenderExperimental(values.experimental, active);
      }
      if (hasOwn(values, "react")) result.react = parseRenderReact(values.react, active);
      if (hasOwn(values, "client")) result.client = parseRenderClient(values.client, active);
      if (hasOwn(values, "cache")) result.cache = parseRenderCache(values.cache, active);
      if (hasOwn(values, "dev")) result.dev = parseRenderDev(values.dev, active);
      if (hasOwn(values, "tailwind")) {
        result.tailwind = parseRenderTailwind(values.tailwind, active);
      }
      return Object.freeze(result);
    },
  );

  const encodedBytes = renderProjectionEncoder.encode(JSON.stringify(projection)).byteLength;
  if (encodedBytes > RENDER_PROJECT_CONFIG_MAX_ENCODED_BYTES) {
    throw new RangeError("Render project config projection exceeds the encoded byte limit");
  }
  return projection;
}

export function assertValidRenderProjectConfigProjection(
  value: unknown,
): asserts value is RenderProjectConfigProjection {
  parseRenderProjectConfigProjection(value);
}
