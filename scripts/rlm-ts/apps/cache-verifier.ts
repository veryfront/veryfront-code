#!/usr/bin/env -S deno run --allow-read --allow-write --allow-net --allow-env

/**
 * RLM Cross-Pod Cache Coherence Verifier
 *
 * Uses an LLM to systematically audit the codebase for a specific class of bug:
 * "Distributed cache stores or returns data that references pod-local filesystem
 *  paths. When a different pod reads from that cache, the files don't exist."
 *
 * This was the root cause of the HTTP bundle "Module not found" cross-pod error.
 * This script hunts for other instances of the same pattern.
 *
 * Usage:
 *   deno run --allow-read --allow-write --allow-net --allow-env scripts/rlm-ts/apps/cache-verifier.ts
 *   deno task cache-verify          # if added to deno.json
 *
 * Outputs a structured report of:
 *   - All distributed cache write sites (what data goes in, does it contain paths?)
 *   - All distributed cache read sites (is the data validated before use?)
 *   - Gap analysis (writes with paths but reads without validation)
 */

import { walk } from "https://deno.land/std@0.224.0/fs/walk.ts";
import { load } from "https://deno.land/std@0.224.0/dotenv/mod.ts";

await load({ export: true, examplePath: null });

// =============================================================================
// TYPES
// =============================================================================

interface CacheSite {
  file: string;
  line: number;
  type: "write" | "read";
  cacheType: "redis" | "distributed" | "memory" | "disk";
  isDistributed: boolean;
  code: string;
  context: string; // surrounding lines
}

interface PathReference {
  file: string;
  line: number;
  pattern: string;
  code: string;
}

interface ValidationSite {
  file: string;
  line: number;
  type: "stat-check" | "exists-check" | "http-bundle-check" | "try-catch-import";
  code: string;
}

interface AuditReport {
  cacheSites: CacheSite[];
  pathReferences: PathReference[];
  validationSites: ValidationSite[];
  gaps: GapAnalysis[];
  summary: string;
}

interface GapAnalysis {
  file: string;
  description: string;
  severity: "critical" | "medium" | "low" | "safe";
  details: string;
}

// =============================================================================
// CONFIGURATION
// =============================================================================

const CONFIG = {
  srcDir: "src",
  maxFileContent: 80000,
  // Patterns that indicate distributed cache operations
  distributedWritePatterns: [
    /distributed\.set\s*\(/,
    /distributedCache\.set\s*\(/,
    /setInRedis\s*\(/,
    /redis.*\.set\s*\(/i,
    /\.setBatch\s*\(/,
    /setCachedTransformAsync\s*\(/,
  ],
  distributedReadPatterns: [
    /distributed\.get\s*\(/,
    /distributedCache\.get\s*\(/,
    /getFromRedis\s*\(/,
    /redis.*\.get\s*\(/i,
    /\.getBatch\s*\(/,
    /getOrComputeTransform\s*\(/,
  ],
  // Patterns that indicate file:// path embedding
  filePathPatterns: [
    /file:\/\//,
    /`file:\/\/\$\{/,
    /"file:\/\//,
    /from\s+"file:\/\//,
  ],
  // Patterns that indicate path validation before use
  validationPatterns: [
    /ensureHttpBundlesExist/,
    /recoverHttpBundleByHash/,
    /extractHttpBundlePaths/,
    /stat\s*\(\s*cached/i,
    /exists\s*\(\s*cached/i,
    /verifiedHttpBundlePaths/,
  ],
};

// =============================================================================
// SCANNING FUNCTIONS
// =============================================================================

async function scanFile(path: string): Promise<{
  cacheSites: CacheSite[];
  pathRefs: PathReference[];
  validations: ValidationSite[];
}> {
  const content = await Deno.readTextFile(path);
  const lines = content.split("\n");

  const cacheSites: CacheSite[] = [];
  const pathRefs: PathReference[] = [];
  const validations: ValidationSite[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const lineNum = i + 1;
    const contextStart = Math.max(0, i - 2);
    const contextEnd = Math.min(lines.length, i + 3);
    const context = lines.slice(contextStart, contextEnd).join("\n");

    // Check for distributed cache writes
    for (const pattern of CONFIG.distributedWritePatterns) {
      if (pattern.test(line)) {
        cacheSites.push({
          file: path,
          line: lineNum,
          type: "write",
          cacheType: /redis/i.test(line) ? "redis" : "distributed",
          isDistributed: true,
          code: line.trim(),
          context,
        });
      }
    }

    // Check for distributed cache reads
    for (const pattern of CONFIG.distributedReadPatterns) {
      if (pattern.test(line)) {
        cacheSites.push({
          file: path,
          line: lineNum,
          type: "read",
          cacheType: /redis/i.test(line) ? "redis" : "distributed",
          isDistributed: true,
          code: line.trim(),
          context,
        });
      }
    }

    // Check for file:// path patterns
    for (const pattern of CONFIG.filePathPatterns) {
      if (pattern.test(line)) {
        pathRefs.push({
          file: path,
          line: lineNum,
          pattern: pattern.source,
          code: line.trim(),
        });
      }
    }

    // Check for validation patterns
    for (const pattern of CONFIG.validationPatterns) {
      if (pattern.test(line)) {
        const validationType = /ensureHttpBundlesExist/.test(line)
          ? "http-bundle-check" as const
          : /recoverHttpBundleByHash/.test(line)
          ? "http-bundle-check" as const
          : /stat/.test(line)
          ? "stat-check" as const
          : /exists/.test(line)
          ? "exists-check" as const
          : "try-catch-import" as const;

        validations.push({
          file: path,
          line: lineNum,
          type: validationType,
          code: line.trim(),
        });
      }
    }
  }

  return { cacheSites, pathRefs, validations };
}

async function scanCodebase(): Promise<{
  cacheSites: CacheSite[];
  pathRefs: PathReference[];
  validations: ValidationSite[];
}> {
  const allCacheSites: CacheSite[] = [];
  const allPathRefs: PathReference[] = [];
  const allValidations: ValidationSite[] = [];

  for await (const entry of walk(CONFIG.srcDir, {
    includeDirs: false,
    exts: ["ts", "tsx"],
    skip: [/node_modules/, /\.test\./, /__fixtures__/, /\.d\.ts$/],
  })) {
    const result = await scanFile(entry.path);
    allCacheSites.push(...result.cacheSites);
    allPathRefs.push(...result.pathRefs);
    allValidations.push(...result.validations);
  }

  return {
    cacheSites: allCacheSites,
    pathRefs: allPathRefs,
    validations: allValidations,
  };
}

// =============================================================================
// ANALYSIS
// =============================================================================

function analyzeGaps(
  cacheSites: CacheSite[],
  pathRefs: PathReference[],
  validations: ValidationSite[],
): GapAnalysis[] {
  const gaps: GapAnalysis[] = [];

  // Group cache sites by file
  const fileMap = new Map<string, CacheSite[]>();
  for (const site of cacheSites) {
    const existing = fileMap.get(site.file) ?? [];
    existing.push(site);
    fileMap.set(site.file, existing);
  }

  // Group path refs by file
  const pathRefMap = new Map<string, PathReference[]>();
  for (const ref of pathRefs) {
    const existing = pathRefMap.get(ref.file) ?? [];
    existing.push(ref);
    pathRefMap.set(ref.file, existing);
  }

  // Group validations by file
  const validationMap = new Map<string, ValidationSite[]>();
  for (const v of validations) {
    const existing = validationMap.get(v.file) ?? [];
    existing.push(v);
    validationMap.set(v.file, existing);
  }

  // For each file with distributed cache operations, check:
  // 1. Does the file write data containing file:// paths to distributed cache?
  // 2. Does the file read from distributed cache and validate paths before use?
  for (const [file, sites] of fileMap) {
    const writes = sites.filter((s) => s.type === "write" && s.isDistributed);
    const reads = sites.filter((s) => s.type === "read" && s.isDistributed);
    const refs = pathRefMap.get(file) ?? [];
    const vals = validationMap.get(file) ?? [];

    const hasFilePathRefs = refs.length > 0;
    const hasValidation = vals.length > 0;

    if (writes.length > 0 && hasFilePathRefs) {
      // This file writes to distributed cache AND has file:// references
      // Check if the written data could contain file:// paths
      const severity = hasValidation ? "safe" : "medium";
      gaps.push({
        file,
        description: `Writes to distributed cache in a file that uses file:// paths`,
        severity: severity as GapAnalysis["severity"],
        details: [
          `  ${writes.length} distributed cache write(s)`,
          `  ${refs.length} file:// path reference(s)`,
          `  ${vals.length} validation check(s)`,
          hasValidation ? "  ✓ Has path validation" : "  ✗ NO path validation found",
        ].join("\n"),
      });
    }

    if (reads.length > 0 && hasFilePathRefs && !hasValidation) {
      // This file reads from distributed cache AND uses file:// paths
      // but has NO validation
      gaps.push({
        file,
        description: `Reads from distributed cache with file:// paths but NO validation`,
        severity: "critical",
        details: [
          `  ${reads.length} distributed cache read(s)`,
          `  ${refs.length} file:// path reference(s)`,
          `  ✗ NO path validation (ensureHttpBundlesExist, stat check, etc.)`,
        ].join("\n"),
      });
    }
  }

  return gaps;
}

function generateSummary(report: AuditReport): string {
  const lines: string[] = [];

  lines.push("═".repeat(70));
  lines.push("CROSS-POD CACHE COHERENCE AUDIT REPORT");
  lines.push("═".repeat(70));
  lines.push("");

  // Stats
  const distributedWrites = report.cacheSites.filter(
    (s) => s.type === "write" && s.isDistributed,
  );
  const distributedReads = report.cacheSites.filter(
    (s) => s.type === "read" && s.isDistributed,
  );

  lines.push("SCAN STATISTICS:");
  lines.push(`  Distributed cache writes: ${distributedWrites.length}`);
  lines.push(`  Distributed cache reads:  ${distributedReads.length}`);
  lines.push(`  file:// path references:  ${report.pathReferences.length}`);
  lines.push(`  Path validation sites:    ${report.validationSites.length}`);
  lines.push("");

  // Gaps by severity
  const critical = report.gaps.filter((g) => g.severity === "critical");
  const medium = report.gaps.filter((g) => g.severity === "medium");
  const safe = report.gaps.filter((g) => g.severity === "safe");

  lines.push("GAP ANALYSIS:");
  lines.push(`  🔴 Critical (no validation): ${critical.length}`);
  lines.push(`  🟡 Medium (partial):          ${medium.length}`);
  lines.push(`  🟢 Safe (validated):          ${safe.length}`);
  lines.push("");

  if (critical.length > 0) {
    lines.push("─".repeat(70));
    lines.push("🔴 CRITICAL GAPS (action required):");
    lines.push("─".repeat(70));
    for (const gap of critical) {
      lines.push(`\n  FILE: ${gap.file}`);
      lines.push(`  ${gap.description}`);
      lines.push(gap.details);
    }
    lines.push("");
  }

  if (medium.length > 0) {
    lines.push("─".repeat(70));
    lines.push("🟡 MEDIUM GAPS (investigate):");
    lines.push("─".repeat(70));
    for (const gap of medium) {
      lines.push(`\n  FILE: ${gap.file}`);
      lines.push(`  ${gap.description}`);
      lines.push(gap.details);
    }
    lines.push("");
  }

  if (safe.length > 0) {
    lines.push("─".repeat(70));
    lines.push("🟢 SAFE (validated):");
    lines.push("─".repeat(70));
    for (const gap of safe) {
      lines.push(`\n  FILE: ${gap.file}`);
      lines.push(`  ${gap.description}`);
      lines.push(gap.details);
    }
    lines.push("");
  }

  // Distributed cache write locations
  lines.push("─".repeat(70));
  lines.push("ALL DISTRIBUTED CACHE WRITES:");
  lines.push("─".repeat(70));
  const uniqueWriteFiles = [...new Set(distributedWrites.map((s) => s.file))];
  for (const file of uniqueWriteFiles) {
    const fileSites = distributedWrites.filter((s) => s.file === file);
    lines.push(`\n  ${file}:`);
    for (const site of fileSites) {
      lines.push(`    L${site.line}: ${site.code.slice(0, 100)}`);
    }
  }
  lines.push("");

  // Distributed cache read locations
  lines.push("─".repeat(70));
  lines.push("ALL DISTRIBUTED CACHE READS:");
  lines.push("─".repeat(70));
  const uniqueReadFiles = [...new Set(distributedReads.map((s) => s.file))];
  for (const file of uniqueReadFiles) {
    const fileSites = distributedReads.filter((s) => s.file === file);
    lines.push(`\n  ${file}:`);
    for (const site of fileSites) {
      lines.push(`    L${site.line}: ${site.code.slice(0, 100)}`);
    }
  }
  lines.push("");

  lines.push("═".repeat(70));

  return lines.join("\n");
}

// =============================================================================
// LLM ANALYSIS (Optional - deep analysis with RLM)
// =============================================================================

async function llmAnalyzeGaps(gaps: GapAnalysis[]): Promise<string | null> {
  const apiKey = Deno.env.get("OPENAI_API_KEY");
  if (!apiKey) return null;

  const criticalGaps = gaps.filter((g) => g.severity === "critical" || g.severity === "medium");
  if (criticalGaps.length === 0) return null;

  // Read the files with gaps for context
  const fileContents: string[] = [];
  for (const gap of criticalGaps) {
    try {
      const content = await Deno.readTextFile(gap.file);
      const lines = content.split("\n");
      // Include first 200 lines for context
      fileContents.push(
        `=== ${gap.file} ===\n${lines.slice(0, 200).map((l, i) => `${i + 1}: ${l}`).join("\n")}`,
      );
    } catch {
      // skip
    }
  }

  const prompt = `You are a distributed systems expert auditing a Kubernetes-deployed codebase for cross-pod cache coherence bugs.

The bug pattern is: "Distributed cache (Redis) stores or returns data that references pod-local filesystem paths. When a different pod reads from that cache, it tries to use those paths but the files don't exist locally."

This was recently found and fixed in the HTTP bundle caching system. The fix involved:
1. Proactively validating file:// paths in cached data before use (ensureHttpBundlesExist)
2. Recovering missing files from distributed cache (recoverHttpBundleByHash)
3. Using canonical paths instead of trusting caller-provided paths

The following gaps were detected by static analysis. For each, determine:
1. Is this a real vulnerability or a false positive?
2. If real, what's the exact failure scenario?
3. What's the recommended fix?

GAPS:
${criticalGaps.map((g) => `${g.file}: ${g.description}\n${g.details}`).join("\n\n")}

FILE CONTENTS:
${fileContents.join("\n\n")}

Respond with a JSON object:
{
  "analysis": [
    {
      "file": "path",
      "isRealVulnerability": true/false,
      "failureScenario": "description of how it would fail",
      "recommendedFix": "what to change",
      "confidence": "high/medium/low"
    }
  ]
}`;

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o",
        messages: [{ role: "user", content: prompt }],
        temperature: 0,
        max_completion_tokens: 4096,
        response_format: { type: "json_object" },
      }),
    });

    if (!response.ok) return null;

    const result = await response.json();
    return result.choices?.[0]?.message?.content ?? null;
  } catch {
    return null;
  }
}

// =============================================================================
// MAIN
// =============================================================================

async function main(): Promise<void> {
  console.log("\n🔍 Scanning codebase for cross-pod cache coherence issues...\n");

  const { cacheSites, pathRefs, validations } = await scanCodebase();

  console.log(`Found ${cacheSites.length} cache operations, ${pathRefs.length} path references, ${validations.length} validations\n`);

  const gaps = analyzeGaps(cacheSites, pathRefs, validations);

  const report: AuditReport = {
    cacheSites,
    pathReferences: pathRefs,
    validationSites: validations,
    gaps,
    summary: "",
  };

  report.summary = generateSummary(report);
  console.log(report.summary);

  // Optional: LLM deep analysis of gaps
  const criticalCount = gaps.filter((g) => g.severity === "critical" || g.severity === "medium").length;
  if (criticalCount > 0) {
    console.log("\n🤖 Running LLM analysis on gaps...\n");
    const llmResult = await llmAnalyzeGaps(gaps);
    if (llmResult) {
      console.log("LLM ANALYSIS:");
      console.log("─".repeat(70));
      try {
        const parsed = JSON.parse(llmResult);
        for (const item of parsed.analysis ?? []) {
          const icon = item.isRealVulnerability ? "🔴" : "✅";
          console.log(`\n${icon} ${item.file}`);
          console.log(`   Real vulnerability: ${item.isRealVulnerability} (confidence: ${item.confidence})`);
          if (item.isRealVulnerability) {
            console.log(`   Failure scenario: ${item.failureScenario}`);
            console.log(`   Fix: ${item.recommendedFix}`);
          }
        }
      } catch {
        console.log(llmResult);
      }
    } else {
      console.log("(Set OPENAI_API_KEY for LLM-powered gap analysis)");
    }
  }

  // Write report to file
  const reportPath = "cache-coherence-report.txt";
  await Deno.writeTextFile(reportPath, report.summary);
  console.log(`\n📄 Report saved to ${reportPath}`);
}

main();
