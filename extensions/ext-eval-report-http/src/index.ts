/**
 * ext-eval-report-http: generic HTTP transport for eval report exports.
 *
 * The extension resolves the core `EvalReportExporterRegistry` contract during
 * setup and registers one or more HTTP-backed `EvalReportExporter`
 * implementations. It intentionally depends only on `fetch`; vendor-specific
 * mapping belongs in the receiving endpoint or a narrower vendor extension.
 *
 * @module extensions/ext-eval-report-http
 */

import type { ExtensionFactory } from "veryfront/extensions";
import {
  type EvalReportExportContext,
  type EvalReportExporter,
  type EvalReportExporterRegistry,
  EvalReportExporterRegistryName,
  type EvalReportExportReceipt,
} from "veryfront/extensions/eval";

const ENV_EXPORTER_ID = "VERYFRONT_EVAL_HTTP_EXPORTER_ID";
const ENV_EXPORTER_URL = "VERYFRONT_EVAL_HTTP_EXPORTER_URL";
const ENV_EXPORTER_TOKEN = "VERYFRONT_EVAL_HTTP_EXPORTER_TOKEN";
const ENV_EXPORTER_HEADERS = "VERYFRONT_EVAL_HTTP_EXPORTER_HEADERS";

type EvalReportHttpFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export interface EvalReportHttpExporterDefinition {
  id: string;
  url?: string;
  token?: string;
  headers?: Record<string, string>;
  method?: "POST" | "PUT";
}

export interface EvalReportHttpExtensionConfig {
  exporters?: EvalReportHttpExporterDefinition[];
  fetch?: EvalReportHttpFetch;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readEnv(name: string): string | undefined {
  try {
    const value = Deno.env.get(name);
    return value && value.length > 0 ? value : undefined;
  } catch {
    return undefined;
  }
}

function parseHeaders(input: string | undefined): Record<string, string> {
  if (!input) return {};

  const trimmed = input.trim();
  if (trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (isRecord(parsed)) {
        return Object.fromEntries(
          Object.entries(parsed).filter((entry): entry is [string, string] =>
            typeof entry[1] === "string"
          ),
        );
      }
    } catch {
      return {};
    }
  }

  const headers: Record<string, string> = {};
  for (const part of input.split(",")) {
    const [key, ...valueParts] = part.split("=");
    if (!key || valueParts.length === 0) continue;
    headers[key.trim()] = valueParts.join("=").trim();
  }
  return headers;
}

function normalizeHeaders(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, string] =>
      typeof entry[1] === "string"
    ),
  );
}

function normalizeExporterDefinition(value: unknown): EvalReportHttpExporterDefinition | undefined {
  if (!isRecord(value) || typeof value.id !== "string" || value.id.length === 0) {
    return undefined;
  }
  return {
    id: value.id,
    ...(typeof value.url === "string" ? { url: value.url } : {}),
    ...(typeof value.token === "string" ? { token: value.token } : {}),
    ...(isRecord(value.headers) ? { headers: normalizeHeaders(value.headers) } : {}),
    ...(value.method === "PUT" ? { method: "PUT" } : {}),
  };
}

function normalizeConfig(config: unknown): EvalReportHttpExtensionConfig {
  if (!isRecord(config)) return {};
  const exporters = Array.isArray(config.exporters)
    ? config.exporters
      .map(normalizeExporterDefinition)
      .filter((entry): entry is EvalReportHttpExporterDefinition => entry !== undefined)
    : undefined;
  return {
    ...(exporters ? { exporters } : {}),
    ...(typeof config.fetch === "function" ? { fetch: config.fetch as EvalReportHttpFetch } : {}),
  };
}

function resolveExporterDefinitions(
  config: EvalReportHttpExtensionConfig,
): EvalReportHttpExporterDefinition[] {
  if (config.exporters && config.exporters.length > 0) return config.exporters;

  return [
    {
      id: readEnv(ENV_EXPORTER_ID) ?? "http",
      url: readEnv(ENV_EXPORTER_URL),
      token: readEnv(ENV_EXPORTER_TOKEN),
      headers: parseHeaders(readEnv(ENV_EXPORTER_HEADERS)),
    },
  ];
}

function createRequestHeaders(
  definition: EvalReportHttpExporterDefinition,
): Record<string, string> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    ...(definition.headers ?? {}),
  };
  if (definition.token) {
    headers.authorization = `Bearer ${definition.token}`;
  }
  return headers;
}

async function readErrorBody(response: Response): Promise<string> {
  try {
    return (await response.text()).trim().slice(0, 1000);
  } catch {
    return "";
  }
}

function readStringField(record: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return undefined;
}

async function parseReceipt(response: Response): Promise<EvalReportExportReceipt | void> {
  if (response.status === 204) return undefined;

  const text = (await response.text()).trim();
  if (text.length === 0) return undefined;

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }

  if (!isRecord(parsed)) return undefined;

  const receipt: EvalReportExportReceipt = {};
  const externalRunId = readStringField(parsed, "externalRunId", "runId", "id");
  const url = readStringField(parsed, "url", "runUrl");
  if (externalRunId) receipt.externalRunId = externalRunId;
  if (url) receipt.url = url;
  if (isRecord(parsed.metadata)) receipt.metadata = parsed.metadata;

  return Object.keys(receipt).length > 0 ? receipt : undefined;
}

export class EvalReportHttpExporter implements EvalReportExporter {
  readonly id: string;
  private readonly definition: EvalReportHttpExporterDefinition & { url: string };
  private readonly fetchImpl: EvalReportHttpFetch;

  constructor(
    definition: EvalReportHttpExporterDefinition & { url: string },
    fetchImpl: EvalReportHttpFetch = fetch,
  ) {
    this.id = definition.id;
    this.definition = definition;
    this.fetchImpl = fetchImpl;
  }

  async export(
    report: Parameters<EvalReportExporter["export"]>[0],
    context: EvalReportExportContext,
  ): Promise<EvalReportExportReceipt | void> {
    const response = await this.fetchImpl(this.definition.url, {
      method: this.definition.method ?? "POST",
      headers: createRequestHeaders(this.definition),
      body: JSON.stringify({ report, context }),
    });

    if (!response.ok) {
      const body = await readErrorBody(response);
      throw new Error(
        `Eval report HTTP exporter "${this.id}" failed with HTTP ${response.status}${
          body ? `: ${body}` : ""
        }`,
      );
    }

    return await parseReceipt(response);
  }
}

export function createEvalReportHttpExporter(
  definition: EvalReportHttpExporterDefinition & { url: string },
  fetchImpl?: EvalReportHttpFetch,
): EvalReportHttpExporter {
  return new EvalReportHttpExporter(definition, fetchImpl);
}

const extEvalReportHttp: ExtensionFactory = (config?: unknown) => {
  const factoryConfig = normalizeConfig(config);
  let registry: EvalReportExporterRegistry | undefined;
  const registeredIds = new Set<string>();

  return {
    name: "ext-eval-report-http",
    version: "0.1.0",
    contracts: {
      requires: ["EvalReportExporterRegistry"],
    },
    capabilities: [
      { type: "net:outbound", hosts: ["*"] },
      {
        type: "env:read",
        keys: [
          "VERYFRONT_EVAL_HTTP_EXPORTER_HEADERS",
          "VERYFRONT_EVAL_HTTP_EXPORTER_ID",
          "VERYFRONT_EVAL_HTTP_EXPORTER_TOKEN",
          "VERYFRONT_EVAL_HTTP_EXPORTER_URL",
        ],
      },
    ],
    setup(ctx) {
      registry = ctx.require<EvalReportExporterRegistry>(EvalReportExporterRegistryName);

      for (const definition of resolveExporterDefinitions(factoryConfig)) {
        if (!definition.url) {
          ctx.logger.info(
            `[ext-eval-report-http] Skipping EvalReportExporter "${definition.id}": no URL configured`,
          );
          continue;
        }

        registry.register(
          new EvalReportHttpExporter(
            { ...definition, url: definition.url },
            factoryConfig.fetch,
          ),
        );
        registeredIds.add(definition.id);
        ctx.logger.info(`[ext-eval-report-http] EvalReportExporter "${definition.id}" registered`);
      }
    },
    teardown() {
      if (!registry) return;
      for (const id of registeredIds) {
        registry.unregister(id);
      }
      registeredIds.clear();
      registry = undefined;
    },
  };
};

export default extEvalReportHttp;
