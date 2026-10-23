/** Runtime-tagged installed-package evidence; callbacks own disposable processes.
 * Native/prototype fixtures run only in Linux Actions. Local unit checks use
 * fake process output and must never execute the native fixture programs.
 */
import {
  INSTALLED_CREDENTIAL_PROBES,
  type InstalledCredentialProbe,
} from "./installed-credential-probes.ts";

export type CredentialProbeRuntime = "node" | "deno" | "bun";
const PROFILE = "installed-runtime-credential-boundary-v2";
const RUNTIMES = ["node", "deno", "bun"];

export function installedRuntimeCredentialProbeProfile(options: {
  githubActions: string | undefined;
  githubJob: string | undefined;
}): boolean {
  return options.githubActions === "true" &&
    options.githubJob === "tests-runtime-critical-flow";
}

interface Output {
  code: number;
  stdout: string;
  stderr: string;
}

function identityLine(text: string, runtime: CredentialProbeRuntime): string {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("Installed credential runtime identity is unconfirmed");
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Installed credential runtime identity is unconfirmed");
  }
  const row = value as Record<string, unknown>;
  if (
    Object.keys(row).length !== 3 || row.profile !== PROFILE ||
    row.runtime !== runtime || typeof row.version !== "string" ||
    row.version.length > 64 ||
    !/^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/.test(row.version) ||
    JSON.stringify({ profile: PROFILE, runtime, version: row.version }) !== text
  ) throw new Error("Installed credential runtime identity is unconfirmed");
  return row.version;
}

function runtimePayload(
  text: string,
  runtime: CredentialProbeRuntime,
  version: string,
  rejected: number,
  safeRequests: number,
) {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("Installed runtime credential payload is unconfirmed");
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Installed runtime credential payload is unconfirmed");
  }
  const row = value as Record<string, unknown>;
  const keys = ["node", "observations", "fetches", "rejected", "cleanRequests"];
  if (Object.hasOwn(row, "undici")) keys.push("undici");
  if (runtime !== "node") keys.push("safeRequests");
  if (
    JSON.stringify(row) !== text || Object.keys(row).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(row, key)) ||
    typeof row.node !== "string" || !/^\d+\.\d+\.\d+$/.test(row.node) ||
    (row.undici !== undefined &&
      (typeof row.undici !== "string" || row.undici.length > 64)) ||
    row.observations !== 0 || row.fetches !== 0 || row.cleanRequests !== 1 ||
    row.rejected !== rejected ||
    (runtime === "node"
      ? row.node !== version
      : row.safeRequests !== safeRequests)
  ) {
    throw new Error("Installed runtime credential assertions are unconfirmed");
  }
  return {
    nodeCompatibilityVersion: row.node,
    ...(typeof row.undici === "string" ? { undici: row.undici } : {}),
    observations: 0,
    fetches: 0,
    rejected,
    safeRequests,
    cleanRequests: 1,
  };
}

export async function runInstalledRuntimeCredentialProbes(options: {
  runtime: CredentialProbeRuntime;
  githubActions: string | undefined;
  runnerOs: string | undefined;
  execute: (fixture: InstalledCredentialProbe) => Promise<Output>;
}) {
  if (!RUNTIMES.includes(options.runtime)) {
    throw new Error("Installed credential runtime is unsupported");
  }
  if (options.githubActions !== "true" || options.runnerOs !== "Linux") {
    throw new Error(
      "Installed runtime credential probes require Linux Actions",
    );
  }
  let version: string | undefined;
  const probes = [];
  for (const probe of INSTALLED_CREDENTIAL_PROBES) {
    const output = await options.execute(probe.file);
    if (
      output.code !== 0 || typeof output.stderr !== "string" ||
      output.stderr !== "" ||
      typeof output.stdout !== "string" || output.stdout.length > 8192
    ) {
      throw new Error(
        "Installed runtime credential probe did not complete cleanly",
      );
    }
    const lines = output.stdout.trimEnd().split("\n");
    const [identity, payloadText] = lines;
    if (
      lines.length !== 2 || identity === undefined || payloadText === undefined
    ) {
      throw new Error(
        "Installed runtime credential probe framing is unconfirmed",
      );
    }
    const observed = identityLine(identity, options.runtime);
    if (version !== undefined && version !== observed) {
      throw new Error("Installed credential runtime changed between probes");
    }
    version = observed;
    const header = probe.file === "native-header-package-probe.mjs";
    const expectedRejected = options.runtime === "node"
      ? probe.rejected
      : header
      ? 0
      : 1;
    const expectedSafe = options.runtime === "node" ? 0 : header ? 3 : 1;
    const payload = runtimePayload(
      payloadText,
      options.runtime,
      observed,
      expectedRejected,
      expectedSafe,
    );
    probes.push({ fixture: probe.file, observed: payload });
  }
  if (version === undefined || probes.length !== 2) {
    throw new Error("Installed credential runtime evidence is incomplete");
  }
  return {
    profile: PROFILE,
    runtime: options.runtime,
    version,
    probes,
    deployedBoundaryAccepted: false as const,
  };
}
