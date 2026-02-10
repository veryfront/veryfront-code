#!/usr/bin/env -S deno run --allow-read

/**
 * Style conventions linter.
 *
 * Enforces conventions not covered by `deno lint`.
 *
 * Usage:
 *   deno task lint:style
 */

import { parseArgs } from "jsr:@std/cli/parse-args";
import { walk } from "@std/fs";
import {
  getColumn,
  getLine,
  parseSource,
  walkAst,
} from "./style-conventions/ast.ts";
import {
  ALLOWED_EXTENSIONS,
  getExtension,
  normalizePath,
  ROOTS,
  RULE_IDS,
  shouldSkipPath,
  STYLE_GUIDE_REFERENCE,
} from "./style-conventions/config.ts";
import { STYLE_RULES } from "./style-conventions/rules/index.ts";
import type {
  AstNodeLike,
  Finding,
  ParseFailure,
  RuleId,
} from "./style-conventions/types.ts";

function formatTotals(totals: Record<RuleId, number>): string {
  return RULE_IDS.map((rule) => `${rule}=${totals[rule]}`).join(", ");
}

function sumFindingsByRule(findings: Finding[]): Record<RuleId, number> {
  const totals = Object.fromEntries(
    RULE_IDS.map((rule) => [rule, 0]),
  ) as Record<RuleId, number>;
  for (const finding of findings) {
    totals[finding.rule] += 1;
  }
  return totals;
}

function printHelp(): void {
  console.log(`Style conventions linter

Usage:
  deno task lint:style

Options:
  --help                   Show this help

Reference:
  ${STYLE_GUIDE_REFERENCE}
`);
}

async function collectFiles(): Promise<string[]> {
  const files: string[] = [];

  for (const root of ROOTS) {
    try {
      for await (
        const entry of walk(root, { includeDirs: false, followSymlinks: false })
      ) {
        if (!entry.isFile) continue;

        const normalized = normalizePath(entry.path);
        const ext = getExtension(normalized);
        if (!ALLOWED_EXTENSIONS.has(ext)) continue;
        if (normalized.endsWith(".d.ts")) continue;
        if (shouldSkipPath(normalized)) continue;

        files.push(normalized);
      }
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) continue;
      throw error;
    }
  }

  files.sort((a, b) => a.localeCompare(b));
  return files;
}

function printParseFailures(failures: ParseFailure[]): void {
  if (failures.length === 0) return;
  console.error(`\n❌ Failed to parse ${failures.length} file(s):\n`);
  for (const failure of failures) {
    console.error(`  - ${failure.file}`);
    console.error(`    ${failure.message}`);
  }
}

function printFindings(findings: Finding[]): void {
  if (findings.length === 0) return;

  const sorted = [...findings].sort((a, b) => {
    if (a.file !== b.file) return a.file.localeCompare(b.file);
    if (a.line !== b.line) return a.line - b.line;
    return a.column - b.column;
  });

  console.error(
    `\n❌ Style convention violations detected (${sorted.length}):\n`,
  );
  for (const finding of sorted) {
    console.error(
      `  - ${finding.file}:${finding.line}:${finding.column} [${finding.rule}]`,
    );
    console.error(`    ${finding.message}`);
  }
}

function analyzeFile(file: string, source: string): Finding[] {
  const ast = parseSource(file, source);
  const findings: Finding[] = [];

  walkAst(ast, (node) => {
    for (const rule of STYLE_RULES) {
      rule.visit(node, {
        file,
        report(targetNode: AstNodeLike, message: string, location): void {
          findings.push({
            rule: rule.id,
            file,
            line: location?.line ?? getLine(targetNode),
            column: location?.column ?? getColumn(targetNode),
            message,
          });
        },
      });
    }
  });

  return findings;
}

const args = parseArgs(Deno.args, {
  boolean: ["help"],
  alias: {
    h: "help",
  },
});

if (args.help) {
  printHelp();
  Deno.exit(0);
}

const files = await collectFiles();
const findings: Finding[] = [];
const parseFailures: ParseFailure[] = [];

for (const file of files) {
  const source = await Deno.readTextFile(file);
  try {
    findings.push(...analyzeFile(file, source));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    parseFailures.push({ file, message });
  }
}

if (parseFailures.length > 0) {
  printParseFailures(parseFailures);
  Deno.exit(1);
}

if (findings.length > 0) {
  printFindings(findings);
  Deno.exit(1);
}

const totals = sumFindingsByRule(findings);
console.log(`✅ Style conventions check passed (${formatTotals(totals)}).`);
