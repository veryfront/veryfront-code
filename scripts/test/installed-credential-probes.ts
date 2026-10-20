/** Validate retained installed-package probes; no package import occurs here. */
export const INSTALLED_CREDENTIAL_PROBES = [
  { file: "native-header-package-probe.mjs", rejected: 3 },
  { file: "native-body-package-probe.mjs", rejected: 2 },
] as const;

export type InstalledCredentialProbe =
  typeof INSTALLED_CREDENTIAL_PROBES[number]["file"];

/** The canonical npm-install job must run probes even when its reusable
 * workflow definition is loaded from main while testing a candidate checkout. */
export function installedCredentialProbeProfile(options: {
  args: readonly string[];
  githubActions: string | undefined;
  githubJob: string | undefined;
}): boolean {
  return options.args.includes("--credential-boundary-probes") ||
    (options.githubActions === "true" &&
      options.githubJob === "tests-npm-install-smoke");
}

interface ProbeOutput {
  code: number;
  stdout: string;
  stderr: string;
}

interface Observation {
  node: string;
  undici?: string;
  observations: number;
  fetches: number;
  rejected: number;
  cleanRequests: number;
}

function validate(output: ProbeOutput, rejected: number): Observation {
  if (
    output.code !== 0 || output.stderr !== "" ||
    output.stdout.length > 4096
  ) throw new Error("Installed credential probe did not complete cleanly");
  let value: unknown;
  try {
    value = JSON.parse(output.stdout);
  } catch {
    throw new Error("Installed credential probe result is not JSON");
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Installed credential probe result is not an object");
  }
  const row = value as Record<string, unknown>;
  const keys = ["node", "observations", "fetches", "rejected", "cleanRequests"];
  if (Object.hasOwn(row, "undici")) keys.push("undici");
  if (
    Object.keys(row).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(row, key)) ||
    typeof row.node !== "string" || !/^\d+\.\d+\.\d+$/.test(row.node) ||
    (row.undici !== undefined &&
      (typeof row.undici !== "string" || row.undici.length > 64)) ||
    row.observations !== 0 || row.fetches !== 0 ||
    row.cleanRequests !== 1 || row.rejected !== rejected
  ) throw new Error("Installed credential probe assertions are unconfirmed");
  return {
    node: row.node,
    ...(typeof row.undici === "string" ? { undici: row.undici } : {}),
    observations: 0,
    fetches: 0,
    rejected,
    cleanRequests: 1,
  };
}

/** Each callback must stage/run/retire one disposable installed-package process. */
export async function runInstalledCredentialProbes(options: {
  githubActions: string | undefined;
  runnerOs: string | undefined;
  execute: (fixture: InstalledCredentialProbe) => Promise<ProbeOutput>;
}): Promise<{
  profile: "installed-node-credential-boundary-v1";
  probes: { fixture: InstalledCredentialProbe; observed: Observation }[];
  deployedBoundaryAccepted: false;
}> {
  // Operational constraint, not an authorization service: these retained native
  // prototype probes must not be run on the shared developer workstation.
  if (options.githubActions !== "true" || options.runnerOs !== "Linux") {
    throw new Error("Installed native credential probes require Linux Actions");
  }
  const probes = [];
  for (const probe of INSTALLED_CREDENTIAL_PROBES) {
    const observed = validate(
      await options.execute(probe.file),
      probe.rejected,
    );
    probes.push({ fixture: probe.file, observed });
  }
  return {
    profile: "installed-node-credential-boundary-v1",
    probes,
    deployedBoundaryAccepted: false,
  };
}
