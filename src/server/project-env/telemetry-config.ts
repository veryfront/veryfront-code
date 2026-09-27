import { readOwnDataProperty } from "#veryfront/security/project-locality.ts";
import { defineOwnDataProperty } from "#veryfront/security/own-data-property.ts";

/** Private exporter settings resolved from an authenticated project env snapshot. */
export interface ProjectTraceConfig {
  readonly projectId: string;
  readonly environmentId: string;
  readonly endpoint: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly serviceName: string;
  readonly serviceVersion: string;
  readonly deploymentEnvironment: string;
  /** Process-local opaque identity for effective settings, including credential changes. */
  readonly revision: string;
}

type InvalidReason = "identity" | "signal" | "endpoint" | "headers" | "resource";
export type ProjectTraceConfigResult =
  | { readonly status: "disabled" }
  | { readonly status: "invalid"; readonly reason: InvalidReason }
  | { readonly status: "enabled"; readonly config: ProjectTraceConfig };

const EXTENSION_NAME = "ext-observability-opentelemetry";
const freeze = Object.freeze;
const NativeURL = URL;
const NativeHeaders = Headers;
const encode = new TextEncoder().encode.bind(new TextEncoder());
const apply = Reflect.apply;
const entries = Object.entries;
const sort = Array.prototype.sort;
const split = String.prototype.split;
const slice = String.prototype.slice;
const trim = String.prototype.trim;
const lower = String.prototype.toLowerCase;
const indexOf = String.prototype.indexOf;
const endsWith = String.prototype.endsWith;
const replace = String.prototype.replace;
const decode = decodeURIComponent;
const setHeader = Headers.prototype.set;
const getHeader = Headers.prototype.get;
const urlGetters = {
  protocol: Object.getOwnPropertyDescriptor(URL.prototype, "protocol")!.get!,
  username: Object.getOwnPropertyDescriptor(URL.prototype, "username")!.get!,
  password: Object.getOwnPropertyDescriptor(URL.prototype, "password")!.get!,
  hash: Object.getOwnPropertyDescriptor(URL.prototype, "hash")!.get!,
  pathname: Object.getOwnPropertyDescriptor(URL.prototype, "pathname")!.get!,
  href: Object.getOwnPropertyDescriptor(URL.prototype, "href")!.get!,
};
const setPathname = Object.getOwnPropertyDescriptor(URL.prototype, "pathname")!.set!;
const generateKey = crypto.subtle.generateKey.bind(crypto.subtle);
const sign = crypto.subtle.sign.bind(crypto.subtle);
let revisionKey: Promise<CryptoKey> | undefined;

function invalid(reason: InvalidReason): ProjectTraceConfigResult {
  return { status: "invalid", reason };
}

function text(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maxLength;
}

function headers(value: unknown): Record<string, string> | undefined {
  if (value === undefined || value === "") return {};
  if (!text(value, 8192)) return undefined;
  const result: Record<string, string> = {};
  try {
    const parts = apply(split, value, [","]) as string[];
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]!;
      const separator = apply(indexOf, part, ["="]) as number;
      if (separator < 1) return undefined;
      const key = apply(lower, apply(trim, apply(slice, part, [0, separator]), []), []) as string;
      // Destination and HTTP framing belong to the guarded transport, not project credentials.
      if (
        key === "host" || key === "content-length" || key === "connection" ||
        key === "transfer-encoding"
      ) {
        return undefined;
      }
      const decoded = decode(apply(trim, apply(slice, part, [separator + 1]), []) as string);
      const validated = new NativeHeaders();
      apply(setHeader, validated, [key, decoded]);
      // A plain own property also handles header names such as __proto__ safely.
      defineOwnDataProperty(result, key, apply(getHeader, validated, [key]), {
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
    return result;
  } catch {
    return undefined;
  }
}

async function revision(config: Omit<ProjectTraceConfig, "revision">): Promise<string> {
  // A keyed digest cannot be used to guess low-entropy credentials from a visible revision.
  // The registry is process-local, so revisions need not match across runtime replicas.
  revisionKey ??= generateKey({ name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const values = [
    config.projectId,
    config.environmentId,
    config.endpoint,
    config.serviceName,
    config.serviceVersion,
    config.deploymentEnvironment,
  ];
  // Length prefixes avoid ambiguous concatenation and JSON prototype hooks.
  let canonical = "";
  for (let i = 0; i < values.length; i++) {
    const value = values[i]!;
    canonical += `${value.length}:${value}`;
  }
  const pairs = entries(config.headers);
  apply(sort, pairs, [
    (a: [string, string], b: [string, string]) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0,
  ]);
  for (let i = 0; i < pairs.length; i++) {
    const pair = pairs[i]!;
    canonical += `${pair[0].length}:${pair[0]}${pair[1].length}:${pair[1]}`;
  }
  const digest = new Uint8Array(await sign("HMAC", await revisionKey, encode(canonical)));
  const hex = "0123456789abcdef";
  let result = "";
  for (let i = 0; i < digest.length; i++) result += hex[digest[i]! >> 4]! + hex[digest[i]! & 15]!;
  return result;
}

/**
 * Read only the supplied authenticated project snapshot, never host/process env.
 * Call before filtering reserved OTEL keys from ordinary shared-runtime project env.
 * The caller must establish identity and authorization; this parser does not do so.
 */
export async function resolveProjectTraceConfig(
  identity: { readonly projectId: string; readonly environmentId: string },
  extensions: readonly unknown[],
  environment: Readonly<Record<string, string>>,
): Promise<ProjectTraceConfigResult> {
  let declared = false;
  for (let i = 0; i < extensions.length; i++) {
    const entry = extensions[i];
    if (readOwnDataProperty(entry, "name") !== EXTENSION_NAME) continue;
    if (readOwnDataProperty(entry, "enabled") === false) return { status: "disabled" };
    declared = true;
  }
  if (!declared) return { status: "disabled" };

  const flag = readOwnDataProperty(environment, "OTEL_TRACES_ENABLED");
  const exporters = readOwnDataProperty(environment, "OTEL_TRACES_EXPORTER");
  if (flag !== undefined && flag !== "true" && flag !== "false" && flag !== "1" && flag !== "0") {
    return invalid("signal");
  }
  if (exporters !== undefined && !text(exporters, 256)) return invalid("signal");
  let enabled = flag === "true" || flag === "1";
  if (flag === undefined && typeof exporters === "string") {
    const names = apply(split, exporters, [","]) as string[];
    for (let i = 0; i < names.length; i++) {
      if (apply(trim, names[i], []) === "otlp") enabled = true;
    }
  }
  if (!enabled) return { status: "disabled" };

  const projectId = readOwnDataProperty(identity, "projectId");
  const environmentId = readOwnDataProperty(identity, "environmentId");
  if (!text(projectId, 256) || !text(environmentId, 256)) return invalid("identity");

  const signalEndpoint = readOwnDataProperty(environment, "OTEL_EXPORTER_OTLP_TRACES_ENDPOINT");
  const baseEndpoint = readOwnDataProperty(environment, "OTEL_EXPORTER_OTLP_ENDPOINT");
  const rawEndpoint = signalEndpoint ?? baseEndpoint;
  if (!text(rawEndpoint, 4096)) return invalid("endpoint");
  let endpoint: string;
  try {
    const url = new NativeURL(rawEndpoint);
    const protocol = apply(urlGetters.protocol, url, []);
    if (
      (protocol !== "https:" && protocol !== "http:") ||
      apply(urlGetters.username, url, []) || apply(urlGetters.password, url, []) ||
      apply(urlGetters.hash, url, [])
    ) {
      return invalid("endpoint");
    }
    const pathname = apply(urlGetters.pathname, url, []) as string;
    if (signalEndpoint === undefined && !apply(endsWith, pathname, ["/v1/traces"])) {
      apply(setPathname, url, [`${apply(replace, pathname, [/\/$/, ""])}/v1/traces`]);
    }
    endpoint = apply(urlGetters.href, url, []) as string;
  } catch {
    return invalid("endpoint");
  }

  const baseHeaders = headers(readOwnDataProperty(environment, "OTEL_EXPORTER_OTLP_HEADERS"));
  const traceHeaders = headers(
    readOwnDataProperty(environment, "OTEL_EXPORTER_OTLP_TRACES_HEADERS"),
  );
  if (!baseHeaders || !traceHeaders) return invalid("headers");
  const serviceName = readOwnDataProperty(environment, "OTEL_SERVICE_NAME") ?? projectId;
  const serviceVersion = readOwnDataProperty(environment, "OTEL_SERVICE_VERSION") ?? "";
  const deploymentEnvironment = readOwnDataProperty(environment, "OTEL_DEPLOYMENT_ENVIRONMENT") ??
    environmentId;
  if (
    !text(serviceName, 256) ||
    typeof serviceVersion !== "string" || serviceVersion.length > 256 ||
    !text(deploymentEnvironment, 256)
  ) return invalid("resource");

  const config = {
    projectId,
    environmentId,
    endpoint,
    headers: freeze({ ...baseHeaders, ...traceHeaders }),
    serviceName,
    serviceVersion,
    deploymentEnvironment,
  };
  return { status: "enabled", config: freeze({ ...config, revision: await revision(config) }) };
}
