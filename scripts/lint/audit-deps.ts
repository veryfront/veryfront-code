/**
 * Dependency audit script — flags supply chain risks in deno.json imports.
 *
 * Checks for:
 * - Unpinned npm versions (e.g., "npm:foo" without @version)
 * - git:// or tarball URLs
 * - Non-https URLs (except local paths)
 * - esm.sh URLs without pinned versions
 *
 * Usage: deno run --allow-read scripts/lint/audit-deps.ts
 */

const denoConfig = JSON.parse(await Deno.readTextFile("deno.json"));
const imports: Record<string, string> = denoConfig.imports ?? {};

interface Issue {
  specifier: string;
  target: string;
  severity: "error" | "warning";
  message: string;
}

const issues: Issue[] = [];

for (const [specifier, target] of Object.entries(imports)) {
  // Skip local path imports
  if (target.startsWith("./") || target.startsWith("../")) continue;
  // Skip jsr: imports (managed by Deno)
  if (target.startsWith("jsr:")) continue;

  // Check for git:// or tarball URLs
  if (target.startsWith("git://") || target.startsWith("git+")) {
    issues.push({
      specifier,
      target,
      severity: "error",
      message: "Git URL import — vulnerable to repo compromise",
    });
    continue;
  }

  if (target.match(/\.(tar\.gz|tgz|tar)$/)) {
    issues.push({
      specifier,
      target,
      severity: "error",
      message: "Tarball import — cannot verify integrity",
    });
    continue;
  }

  // Check npm: imports for version pinning
  if (target.startsWith("npm:")) {
    const hasVersion = target.match(/npm:.+@\d/);
    if (!hasVersion) {
      issues.push({
        specifier,
        target,
        severity: "warning",
        message: "Unpinned npm version — specify exact version for reproducibility",
      });
    }
    continue;
  }

  // Check https:// URLs (esm.sh etc.)
  if (target.startsWith("https://")) {
    if (!target.startsWith("https://esm.sh/") && !target.startsWith("https://jsr.io/")) {
      issues.push({
        specifier,
        target,
        severity: "warning",
        message: "Non-standard CDN URL — ensure this source is trusted",
      });
    }

    // Check esm.sh for version pinning
    if (target.startsWith("https://esm.sh/")) {
      const hasVersion = target.match(/esm\.sh\/.+@\d/);
      if (!hasVersion) {
        issues.push({
          specifier,
          target,
          severity: "warning",
          message: "Unpinned esm.sh version — specify exact version",
        });
      }
    }
    continue;
  }

  // Check for http:// (non-TLS)
  if (target.startsWith("http://")) {
    issues.push({
      specifier,
      target,
      severity: "error",
      message: "Non-HTTPS import — vulnerable to MITM attacks",
    });
  }
}

// Report results
if (issues.length === 0) {
  console.log("✅ No supply chain issues found in dependency imports.");
  Deno.exit(0);
}

const errors = issues.filter((i) => i.severity === "error");
const warnings = issues.filter((i) => i.severity === "warning");

if (warnings.length > 0) {
  console.log(`\n⚠️  ${warnings.length} warning(s):`);
  for (const w of warnings) {
    console.log(`  ${w.specifier}: ${w.message}`);
    console.log(`    → ${w.target}`);
  }
}

if (errors.length > 0) {
  console.log(`\n❌ ${errors.length} error(s):`);
  for (const e of errors) {
    console.log(`  ${e.specifier}: ${e.message}`);
    console.log(`    → ${e.target}`);
  }
  Deno.exit(1);
}

console.log("\n✅ No blocking issues (warnings only).");
