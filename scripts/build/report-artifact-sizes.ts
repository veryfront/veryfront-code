#!/usr/bin/env -S deno run --allow-read --allow-run=npm

import { parseArgs } from "#std/flags";
import { basename } from "#std/path.ts";

export interface ArtifactSizeEntry {
  artifact: string;
  bytes: number;
  kind: string;
}

interface NpmPackResult {
  name?: unknown;
  size?: unknown;
  unpackedSize?: unknown;
  version?: unknown;
}

const USAGE = `Usage:
  deno run --allow-read --allow-run=npm scripts/build/report-artifact-sizes.ts [options] [artifact ...]

Options:
  --npm-package <directory>  Measure an npm package with npm pack --dry-run
  --help                     Show this help

This command reports artifact sizes. It does not enforce size limits.`;

export function formatArtifactSize(bytes: number): string {
  if (!Number.isSafeInteger(bytes) || bytes < 0) {
    throw new TypeError("Artifact size must be a non-negative integer");
  }
  if (bytes < 1_000) return `${bytes} B`;
  if (bytes < 1_000_000) return `${(bytes / 1_000).toFixed(2)} KB`;
  if (bytes < 1_000_000_000) return `${(bytes / 1_000_000).toFixed(2)} MB`;
  return `${(bytes / 1_000_000_000).toFixed(2)} GB`;
}

function isSize(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

export function parseNpmPackOutput(output: string): ArtifactSizeEntry[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(output);
  } catch {
    throw new Error("npm pack did not return valid JSON");
  }

  const result = Array.isArray(parsed) ? parsed[0] as NpmPackResult | undefined : undefined;
  if (
    !result || typeof result.name !== "string" ||
    typeof result.version !== "string" || !isSize(result.size) ||
    !isSize(result.unpackedSize)
  ) {
    throw new Error("npm pack did not return package size metadata");
  }

  const artifact = `${result.name}@${result.version}`;
  return [
    { artifact, kind: "npm tarball", bytes: result.size },
    { artifact, kind: "npm unpacked", bytes: result.unpackedSize },
  ];
}

export function renderArtifactSizeReport(entries: readonly ArtifactSizeEntry[]): string {
  const rows = entries.map((entry) =>
    `| \`${entry.artifact}\` | ${entry.kind} | ${entry.bytes.toLocaleString("en-US")} | ${
      formatArtifactSize(entry.bytes)
    } |`
  );
  return [
    "## Artifact sizes",
    "",
    "| Artifact | Kind | Bytes | Size |",
    "| --- | --- | ---: | ---: |",
    ...rows,
  ].join("\n");
}

function classifyArtifact(name: string): string {
  if (name.startsWith("veryfront-proxy-")) return "Proxy binary";
  if (name.startsWith("veryfront-")) return "CLI binary";
  return "File";
}

async function measureArtifact(path: string): Promise<ArtifactSizeEntry> {
  const stat = await Deno.stat(path);
  if (!stat.isFile) {
    throw new Error(`Artifact is not a file: ${path}`);
  }
  const artifact = basename(path);
  return { artifact, kind: classifyArtifact(artifact), bytes: stat.size };
}

async function measureNpmPackage(directory: string): Promise<ArtifactSizeEntry[]> {
  const command = new Deno.Command("npm", {
    args: ["pack", "--dry-run", "--json", "--ignore-scripts"],
    cwd: directory,
    stderr: "piped",
    stdout: "piped",
  });
  const result = await command.output();
  if (!result.success) {
    const detail = new TextDecoder().decode(result.stderr).trim();
    throw new Error(detail || `npm pack failed with exit code ${result.code}`);
  }
  return parseNpmPackOutput(new TextDecoder().decode(result.stdout));
}

async function main(args: string[]): Promise<void> {
  const parsed = parseArgs(args, {
    boolean: ["help"],
    string: ["npm-package"],
  });
  if (parsed.help) {
    console.log(USAGE);
    return;
  }

  const entries: ArtifactSizeEntry[] = [];
  if (parsed["npm-package"]) {
    entries.push(...await measureNpmPackage(parsed["npm-package"]));
  }
  for (const path of parsed._) {
    entries.push(await measureArtifact(String(path)));
  }
  if (entries.length === 0) {
    throw new Error("Provide --npm-package or at least one artifact path");
  }

  console.log(renderArtifactSizeReport(entries));
}

if (import.meta.main) {
  await main(Deno.args);
}
