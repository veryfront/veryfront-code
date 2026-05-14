/**
 * Dependency audit script — flags supply chain risks in deno.json imports.
 *
 * Checks for:
 * - Unpinned npm versions (e.g., "npm:foo" without @x.y.z) → error
 * - git:// or tarball URLs → error
 * - Non-https URLs (except local paths) → error
 * - esm.sh URLs without exact x.y.z version pins → error
 * - Non-esm.sh https CDNs → warning
 *
 * Usage: deno run --allow-read scripts/lint/audit-deps.ts
 */

export type Severity = "error" | "warning";

export interface AuditIssue {
  sourceLocation?: string;
  specifier: string;
  target: string;
  severity: Severity;
  message: string;
}

export interface ImportMapManifest {
  sourceLocation: string;
  imports: Record<string, string>;
}

// Shared by auditEsmShPin and auditNpmPin so both CDN paths apply the same
// definition of "pinned". Allows pre-release suffixes (e.g., 1.2.3-rc.1).
const EXACT_SEMVER_RE = /^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/;

/**
 * Inspect an https:// import target. Returns null when the target is fine
 * (or non-https, which is handled elsewhere). Reports:
 * - non-esm.sh CDN → warning (must be reviewed for trust)
 * - esm.sh URL missing version → error
 * - esm.sh URL not pinned to exact x.y.z (no caret, tilde, major-only) → error
 */
export function auditEsmShPin(
  target: string,
  specifier = "",
): AuditIssue | null {
  if (!target.startsWith("https://esm.sh/")) {
    if (target.startsWith("https://")) {
      // jsr.io is managed by Deno (handled by the jsr: branch in main loop);
      // anything else is an unknown CDN.
      if (target.startsWith("https://jsr.io/")) return null;
      return {
        specifier,
        target,
        severity: "warning",
        message: "Non-esm.sh CDN — ensure source is trusted",
      };
    }
    return null;
  }

  const path = target.split("?")[0];
  // Match either scoped (@scope/name) or unscoped (name) before @version
  const versionMatch = path.match(
    /esm\.sh\/(?:@[^/@]+\/[^@/]+|[^@/]+)@([^/]+)/,
  );
  if (!versionMatch) {
    return {
      specifier,
      target,
      severity: "error",
      message: "esm.sh URL missing version pin",
    };
  }
  const ver = versionMatch[1];

  if (!EXACT_SEMVER_RE.test(ver)) {
    return {
      specifier,
      target,
      severity: "error",
      message: `esm.sh URL not pinned to exact x.y.z (got "${ver}")`,
    };
  }
  return null;
}

/**
 * Inspect an npm: import target. Returns null when the target is pinned to
 * exact x.y.z (optionally with a pre-release suffix). Otherwise reports an
 * error. Mirrors `auditEsmShPin` so the two CDN paths can't silently diverge
 * on what counts as "pinned" — the SECURITY.md policy promises the same
 * guarantee for both.
 */
export function auditNpmPin(target: string, specifier = ""): AuditIssue | null {
  if (!target.startsWith("npm:")) return null;
  // npm:[@scope/]name@version[/subpath]
  const match = target.match(/^npm:(?:@[^/@]+\/[^@/]+|[^@/]+)@([^/]+)/);
  const ver = match?.[1];
  if (!ver || !EXACT_SEMVER_RE.test(ver)) {
    return {
      specifier,
      target,
      severity: "error",
      message: ver
        ? `Unpinned npm version — specify exact x.y.z (got "${ver}")`
        : "Unpinned npm version — specify exact version (x.y.z) for reproducibility",
    };
  }
  return null;
}

export function auditDependencyImports(
  manifests: ImportMapManifest[],
): AuditIssue[] {
  const issues: AuditIssue[] = [];

  for (const manifest of manifests) {
    for (const [specifier, target] of Object.entries(manifest.imports)) {
      if (target.startsWith("./") || target.startsWith("../")) continue;
      if (target.startsWith("jsr:")) continue;

      const withSource = (issue: AuditIssue): AuditIssue => ({
        sourceLocation: manifest.sourceLocation,
        ...issue,
      });

      if (target.startsWith("git://") || target.startsWith("git+")) {
        issues.push(withSource({
          specifier,
          target,
          severity: "error",
          message: "Git URL import — vulnerable to repo compromise",
        }));
        continue;
      }

      if (target.match(/\.(tar\.gz|tgz|tar)([?#]|$)/)) {
        issues.push(withSource({
          specifier,
          target,
          severity: "error",
          message: "Tarball import — cannot verify integrity",
        }));
        continue;
      }

      if (target.startsWith("npm:")) {
        const issue = auditNpmPin(target, specifier);
        if (issue) issues.push(withSource(issue));
        continue;
      }

      if (target.startsWith("https://")) {
        const issue = auditEsmShPin(target, specifier);
        if (issue) issues.push(withSource(issue));
        continue;
      }

      if (target.startsWith("http://")) {
        issues.push(withSource({
          specifier,
          target,
          severity: "error",
          message: "Non-HTTPS import — vulnerable to MITM attacks",
        }));
      }
    }
  }

  return issues;
}

function normalizeWorkspaceMemberPath(path: string): string {
  return path.replaceAll("\\", "/").replace(/^\.\//, "").replace(/\/+$/, "");
}

async function readImportMapManifests(): Promise<ImportMapManifest[]> {
  const denoConfig = JSON.parse(await Deno.readTextFile("deno.json"));
  const manifests: ImportMapManifest[] = [{
    sourceLocation: "deno.json",
    imports: denoConfig.imports ?? {},
  }];

  if (Array.isArray(denoConfig.workspace)) {
    for (const entry of denoConfig.workspace) {
      if (typeof entry !== "string") continue;
      const memberPath = normalizeWorkspaceMemberPath(entry);
      if (!memberPath) continue;
      const sourceLocation = `${memberPath}/deno.json`;
      const memberConfig = JSON.parse(await Deno.readTextFile(sourceLocation));
      manifests.push({
        sourceLocation,
        imports: memberConfig.imports ?? {},
      });
    }
  }

  return manifests;
}

if (import.meta.main) {
  const issues = auditDependencyImports(await readImportMapManifests());

  if (issues.length === 0) {
    console.log("✅ No supply chain issues found in dependency imports.");
    Deno.exit(0);
  }

  const errors = issues.filter((i) => i.severity === "error");
  const warnings = issues.filter((i) => i.severity === "warning");

  if (warnings.length > 0) {
    console.log(`\n⚠️  ${warnings.length} warning(s):`);
    for (const w of warnings) {
      console.log(
        `  ${w.sourceLocation ?? "deno.json"}: ${w.specifier}: ${w.message}`,
      );
      console.log(`    → ${w.target}`);
    }
  }

  if (errors.length > 0) {
    console.log(`\n❌ ${errors.length} error(s):`);
    for (const e of errors) {
      console.log(
        `  ${e.sourceLocation ?? "deno.json"}: ${e.specifier}: ${e.message}`,
      );
      console.log(`    → ${e.target}`);
    }
    Deno.exit(1);
  }

  console.log("\n✅ No blocking issues (warnings only).");
}
