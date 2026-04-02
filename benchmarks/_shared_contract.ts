import { dirname, extname, fromFileUrl, join } from "#std/path";

export type BenchmarkKind = "browser_and_server" | "server_only";
export type RequestMode = "cold" | "warm";

export interface RequestProfileRecord {
  sequence: number;
  category: string;
  method: string;
  pathname: string;
  projectSlug?: string;
  requestMode?: string;
  status?: number;
  startedAt: string;
  completedAt: string;
  totalMs: number;
  phases: Record<string, number>;
}

export interface ProfilingSnapshot {
  enabled: boolean;
  last_sequence: number;
  records: RequestProfileRecord[];
}

export interface ProfilingDeltaSummary {
  records: RequestProfileRecord[];
  totals_by_phase: Record<string, number>;
  by_category: Record<string, { count: number; total_ms: number }>;
}

export interface ScenarioRequirements {
  async_data: boolean;
  hydration: boolean;
  streaming: boolean;
  api_shape: Record<string, unknown> | null;
}

export interface BenchmarkScenario {
  id: string;
  kind: BenchmarkKind;
  path: string;
  description: string;
  primary_metrics: string[];
  requirements: ScenarioRequirements;
}

export interface BenchmarkContract {
  version: number;
  phase: string;
  comparison_frameworks: string[];
  metrics: {
    browser_primary: string[];
    server_primary: string[];
  };
  fairness_rules: Record<string, unknown>;
  scenarios: BenchmarkScenario[];
}

const __dirname = dirname(fromFileUrl(import.meta.url));
export const BENCHMARKS_ROOT = __dirname;
const DEFAULT_CONTRACT_PATH = join(__dirname, "scenarios", "canonical-scenarios.json");

export async function loadBenchmarkContract(
  path = DEFAULT_CONTRACT_PATH,
): Promise<BenchmarkContract> {
  const raw = await Deno.readTextFile(path);
  const parsed = JSON.parse(raw) as BenchmarkContract;

  if (!Array.isArray(parsed.scenarios) || parsed.scenarios.length === 0) {
    throw new Error(`Benchmark contract at ${path} does not define any scenarios`);
  }

  return parsed;
}

export function getScenarioPath(
  baseUrl: string,
  scenario: BenchmarkScenario,
  options?: { forceProductionScripts?: boolean },
): string {
  const url = new URL(scenario.path, baseUrl);
  if (options?.forceProductionScripts) {
    url.searchParams.set("forceProductionScripts", "1");
  }
  return url.toString();
}

export function getResultsDir(kind: "browser" | "server"): string {
  return join(dirname(DEFAULT_CONTRACT_PATH), "..", "results", kind);
}

export function getReportDir(): string {
  return join(BENCHMARKS_ROOT, "report");
}

export function getStringFlag(flagName: string): string | undefined {
  const normalizedFlag = `--${flagName}`;

  for (let index = 0; index < Deno.args.length; index += 1) {
    const current = Deno.args[index];
    if (!current) continue;

    if (current === normalizedFlag) {
      return Deno.args[index + 1];
    }

    if (current.startsWith(`${normalizedFlag}=`)) {
      return current.slice(normalizedFlag.length + 1);
    }
  }

  return undefined;
}

export function getIntegerFlag(flagName: string): number | undefined {
  const raw = getStringFlag(flagName);
  if (!raw) return undefined;

  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function getBooleanFlag(flagName: string, defaultValue = false): boolean {
  const raw = getStringFlag(flagName);
  if (raw == null) return defaultValue;
  if (raw === "") return true;

  switch (raw.toLowerCase()) {
    case "1":
    case "true":
    case "yes":
    case "on":
      return true;
    case "0":
    case "false":
    case "no":
    case "off":
      return false;
    default:
      return defaultValue;
  }
}

export function getRequestModeFlag(defaultMode: RequestMode = "cold"): RequestMode {
  const raw = getStringFlag("request-mode") ?? Deno.env.get("BENCH_REQUEST_MODE") ?? defaultMode;
  return raw === "warm" ? "warm" : "cold";
}

export async function writeBenchmarkResult(
  kind: "browser" | "server",
  name: string,
  data: unknown,
): Promise<string> {
  const dir = getResultsDir(kind);
  await Deno.mkdir(dir, { recursive: true });

  const sanitized = name.replace(/[^a-zA-Z0-9._-]+/g, "-");
  const filePath = join(dir, `${sanitized}.json`);
  await Deno.writeTextFile(filePath, JSON.stringify(data, null, 2));
  return filePath;
}

export async function writeReportArtifact(
  name: string,
  contents: string,
  extension: ".json" | ".md",
): Promise<string> {
  const dir = getReportDir();
  await Deno.mkdir(dir, { recursive: true });

  const sanitized = name.replace(/[^a-zA-Z0-9._-]+/g, "-");
  const filePath = join(dir, `${sanitized}${extension}`);
  await Deno.writeTextFile(filePath, contents);
  return filePath;
}

export function summarizeProfilingDelta(records: RequestProfileRecord[]): ProfilingDeltaSummary {
  const totalsByPhase = new Map<string, number>();
  const byCategory = new Map<string, { count: number; total_ms: number }>();

  for (const record of records) {
    for (const [phase, duration] of Object.entries(record.phases)) {
      totalsByPhase.set(
        phase,
        Math.round(((totalsByPhase.get(phase) ?? 0) + duration) * 100) / 100,
      );
    }

    const existing = byCategory.get(record.category) ?? { count: 0, total_ms: 0 };
    existing.count += 1;
    existing.total_ms = Math.round((existing.total_ms + record.totalMs) * 100) / 100;
    byCategory.set(record.category, existing);
  }

  return {
    records,
    totals_by_phase: Object.fromEntries(totalsByPhase.entries()),
    by_category: Object.fromEntries(byCategory.entries()),
  };
}

export async function listJsonArtifacts(dir: string): Promise<string[]> {
  try {
    const entries: string[] = [];

    for await (const entry of Deno.readDir(dir)) {
      if (!entry.isFile || extname(entry.name) !== ".json") continue;
      entries.push(join(dir, entry.name));
    }

    return entries.sort();
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return [];
    throw error;
  }
}
