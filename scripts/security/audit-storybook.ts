/**
 * Storybook dependency audit.
 *
 * Runs `npm audit` against storybook/package-lock.json and fails on any high
 * or critical advisory that is not listed in STORYBOOK_AUDIT_EXEMPTIONS.
 *
 * Usage: deno run --allow-read --allow-run=npm scripts/security/audit-storybook.ts
 */

export const STORYBOOK_AUDIT_NPM_ARGS = [
  "--prefix",
  "storybook",
  "audit",
  "--package-lock-only",
  "--json",
] as const;

export interface AuditExemption {
  /** GitHub advisory id, the last path segment of the advisory URL. */
  id: string;
  /** Package the advisory is filed against. */
  package: string;
  /**
   * The advisory's vulnerable range exactly as npm reports it. The exemption
   * stops applying when the advisory changes this range.
   */
  range: string;
  /**
   * The package's `latest` release when the exemption was written, which the
   * advisory still covers. A patched release does not have to change the
   * advisory's range (`<=4.0.7` already excludes 4.0.8), and npm's
   * `fixAvailable` is no signal either: it is set as soon as downgrading a
   * parent package would drop the dependency. So the exemption stops applying
   * when the registry's `latest` moves past this version, and the audit fails
   * until someone upgrades or confirms the new release is still vulnerable.
   */
  unpatchedLatest: string;
  reason: string;
}

/**
 * Advisories accepted for the Storybook toolchain only. Storybook is a
 * development tool: nothing here ships in the published packages, which
 * scripts/security/audit-npm.ts audits without exemptions.
 */
export const STORYBOOK_AUDIT_EXEMPTIONS: readonly AuditExemption[] = [
  {
    id: "GHSA-fc5q-39xc-vjpf",
    package: "picomatch",
    range: "<=4.0.7",
    unpatchedLatest: "4.0.7",
    reason:
      "ReDoS in glob matching with no patched picomatch release. Reached only through Storybook's build tooling (vite, tinyglobby, @rollup/pluginutils, unplugin), which matches globs from this repository's own configuration.",
  },
];

interface Advisory {
  id: string;
  package: string;
  range: string;
  severity: string;
  title: string;
  url: string;
}

export interface BlockingFinding {
  package: string;
  severity: string;
  /** Unexempted high or critical advisories; empty when none could be resolved. */
  advisories: Advisory[];
}

export interface StorybookAuditResult {
  blocking: BlockingFinding[];
  /** Exemptions that suppressed at least one finding. */
  appliedExemptions: AuditExemption[];
  /** Exemptions that matched nothing and should be removed. */
  unusedExemptions: AuditExemption[];
}

const BLOCKING_SEVERITIES = new Set(["high", "critical"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseAdvisory(value: Record<string, unknown>): Advisory | undefined {
  const { name, range, severity, title, url } = value;
  if (
    typeof name !== "string" || typeof range !== "string" ||
    typeof severity !== "string" || typeof url !== "string"
  ) {
    return undefined;
  }
  const id = url.split("/").pop() ?? "";
  if (!/^GHSA(-[0-9a-z]{4}){3}$/.test(id)) return undefined;
  return {
    id,
    package: name,
    range,
    severity,
    title: typeof title === "string" ? title : "",
    url,
  };
}

/**
 * Decide which findings of an `npm audit --json` report block the audit.
 *
 * Fails closed: a report that is not the expected shape throws, and a high or
 * critical package whose advisories cannot all be read is reported as blocking.
 */
export function evaluateStorybookAudit(
  report: unknown,
  exemptions: readonly AuditExemption[],
  /** The registry's current `latest` version of each exempted package. */
  latestVersions: Readonly<Record<string, string>>,
): StorybookAuditResult {
  if (!isRecord(report) || report.auditReportVersion !== 2) {
    throw new Error("npm audit report is not auditReportVersion 2.");
  }
  if ("error" in report) {
    throw new Error(`npm audit reported an error: ${JSON.stringify(report.error)}`);
  }
  const vulnerabilities = report.vulnerabilities;
  if (!isRecord(vulnerabilities)) {
    throw new Error("npm audit report has no vulnerabilities object.");
  }

  const applied = new Set<AuditExemption>();
  const findExemption = (advisory: Advisory): AuditExemption | undefined =>
    exemptions.find((exemption) =>
      exemption.id === advisory.id && exemption.package === advisory.package &&
      exemption.range === advisory.range &&
      latestVersions[exemption.package] === exemption.unpatchedLatest
    );

  // A package's `via` lists its own advisories as objects and the packages it
  // inherits a vulnerability from as names. Follow the names to the advisories.
  const resolve = (
    packageName: string,
    visited: Set<string>,
  ): { advisories: Advisory[]; unreadable: boolean } => {
    if (visited.has(packageName)) return { advisories: [], unreadable: false };
    visited.add(packageName);
    const entry = vulnerabilities[packageName];
    if (!isRecord(entry) || !Array.isArray(entry.via) || entry.via.length === 0) {
      return { advisories: [], unreadable: true };
    }
    const advisories: Advisory[] = [];
    let unreadable = false;
    for (const via of entry.via) {
      if (typeof via === "string") {
        const inherited = resolve(via, visited);
        advisories.push(...inherited.advisories);
        unreadable ||= inherited.unreadable;
      } else if (isRecord(via)) {
        const advisory = parseAdvisory(via);
        if (advisory) advisories.push(advisory);
        else unreadable = true;
      } else {
        unreadable = true;
      }
    }
    return { advisories, unreadable };
  };

  const blocking: BlockingFinding[] = [];
  for (const [packageName, entry] of Object.entries(vulnerabilities)) {
    if (!isRecord(entry) || typeof entry.severity !== "string") {
      blocking.push({ package: packageName, severity: "unknown", advisories: [] });
      continue;
    }
    if (!BLOCKING_SEVERITIES.has(entry.severity)) continue;

    const { advisories, unreadable } = resolve(packageName, new Set());
    const severe = advisories.filter((advisory) => BLOCKING_SEVERITIES.has(advisory.severity));
    const unexempted: Advisory[] = [];
    for (const advisory of severe) {
      const exemption = findExemption(advisory);
      if (exemption) applied.add(exemption);
      else if (!unexempted.some((seen) => seen.id === advisory.id)) unexempted.push(advisory);
    }
    // No readable severe advisory for a severe package means the report and
    // this reader disagree, so the finding blocks.
    if (unreadable || severe.length === 0 || unexempted.length > 0) {
      blocking.push({ package: packageName, severity: entry.severity, advisories: unexempted });
    }
  }

  return {
    blocking: blocking.sort((left, right) => left.package.localeCompare(right.package)),
    appliedExemptions: exemptions.filter((exemption) => applied.has(exemption)),
    unusedExemptions: exemptions.filter((exemption) => !applied.has(exemption)),
  };
}

if (import.meta.main) {
  // npm audit exits non-zero whenever it finds a vulnerability, so its exit
  // status is ignored on purpose: the JSON report decides, and anything that
  // is not a readable report fails below.
  const output = await new Deno.Command("npm", {
    args: [...STORYBOOK_AUDIT_NPM_ARGS],
    stdout: "piped",
    stderr: "piped",
  }).output();
  const stdout = new TextDecoder().decode(output.stdout);

  const latestVersions: Record<string, string> = {};
  for (const exemption of STORYBOOK_AUDIT_EXEMPTIONS) {
    const lookup = await new Deno.Command("npm", {
      args: ["view", exemption.package, "dist-tags.latest"],
      stdout: "piped",
      stderr: "piped",
    }).output();
    const latest = new TextDecoder().decode(lookup.stdout).trim();
    if (!lookup.success || !/^\d+\.\d+\.\d+/.test(latest)) {
      console.error(
        `❌ Storybook npm audit failed: could not read the latest ${exemption.package} version, so the ${exemption.id} exemption cannot be checked.`,
      );
      console.error("stderr:", new TextDecoder().decode(lookup.stderr).slice(0, 500));
      Deno.exit(1);
    }
    latestVersions[exemption.package] = latest;
  }

  let report: unknown;
  try {
    report = JSON.parse(stdout);
  } catch {
    console.error("❌ Storybook npm audit failed: non-JSON output (possible network or registry error).");
    console.error("stdout:", stdout.slice(0, 500));
    console.error("stderr:", new TextDecoder().decode(output.stderr).slice(0, 500));
    Deno.exit(1);
  }

  let result: StorybookAuditResult;
  try {
    result = evaluateStorybookAudit(report, STORYBOOK_AUDIT_EXEMPTIONS, latestVersions);
  } catch (error) {
    console.error(`❌ Storybook npm audit failed: ${error instanceof Error ? error.message : error}`);
    Deno.exit(1);
  }

  for (const exemption of result.appliedExemptions) {
    console.log(
      `⚠️  Exempted ${exemption.id} (${exemption.package} ${exemption.range}): ${exemption.reason}`,
    );
  }
  for (const exemption of result.unusedExemptions) {
    console.error(
      `❌ Exemption ${exemption.id} (${exemption.package} ${exemption.range}, unpatched through ${exemption.unpatchedLatest}) no longer applies: the advisory changed, or ${exemption.package} released ${latestVersions[exemption.package]}. Upgrade ${exemption.package} if that release is patched and remove the entry from scripts/security/audit-storybook.ts, or update the entry if it is still vulnerable.`,
    );
  }
  for (const finding of result.blocking) {
    console.error(`❌ ${finding.severity.toUpperCase()} ${finding.package}`);
    if (finding.advisories.length === 0) {
      console.error("     its advisories could not be read from the npm audit report");
    }
    for (const advisory of finding.advisories) {
      console.error(`     ${advisory.id} ${advisory.package} ${advisory.range}: ${advisory.title}`);
      console.error(`     ${advisory.url}`);
    }
  }

  if (result.blocking.length > 0 || result.unusedExemptions.length > 0) {
    console.error("\n❌ Storybook audit failed.");
    Deno.exit(1);
  }
  console.log("✅ Storybook audit passed: no unexempted high or critical vulnerabilities.");
}
