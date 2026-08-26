/**
 * Template loader using a compressed manifest.
 *
 * Templates are compiled to a compressed manifest at build time, which allows
 * them to be embedded in compiled binaries without deno compile trying
 * to analyze them as TypeScript modules.
 */

import type { TemplateFile } from "./types.ts";
import { COMPRESSED_TEMPLATE_MANIFEST_BASE64 } from "./manifest.generated.ts";

interface TemplateManifest {
  version: number;
  templates: Record<string, { files: Record<string, string> }>;
}

let manifestPromise: Promise<TemplateManifest> | undefined;

function decodeBase64(value: string): ArrayBuffer {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes.buffer;
}

async function decompressManifest(): Promise<TemplateManifest> {
  const bytes = decodeBase64(COMPRESSED_TEMPLATE_MANIFEST_BASE64);
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  return JSON.parse(await new Response(stream).text()) as TemplateManifest;
}

function getManifest(): Promise<TemplateManifest> {
  return manifestPromise ??= decompressManifest();
}

function getSortedFiles(entry: { files: Record<string, string> }): TemplateFile[] {
  return Object.entries(entry.files)
    .map(([path, content]) => ({ path, content }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * Overlay one set of template files onto another, later paths winning.
 *
 * Used to layer the integration scaffold and generated files (AGENTS.md,
 * .env.example) over a starter template.
 */
export function mergeFiles(
  baseFiles: TemplateFile[],
  overlayFiles: TemplateFile[],
): TemplateFile[] {
  const fileMap = new Map<string, TemplateFile>();

  for (const file of baseFiles) fileMap.set(file.path, file);
  for (const file of overlayFiles) fileMap.set(file.path, file);

  return Array.from(fileMap.values()).sort((a, b) => a.path.localeCompare(b.path));
}

export async function loadTemplateFromDirectory(
  templateName: string,
): Promise<TemplateFile[]> {
  const entry = (await getManifest()).templates[templateName];
  if (!entry) return [];

  return getSortedFiles(entry);
}

export async function loadAiRuleTemplate(templateName: string): Promise<string | null> {
  const entry = (await getManifest()).templates[`ai-rules:${templateName}`];
  if (!entry) return null;

  return entry.files[templateName] ?? null;
}

export function getTemplateDirectory(templateName: string): string {
  // For compatibility - returns a virtual path since templates are in manifest
  return `manifest://${templateName}`;
}

export async function templateDirectoryExists(
  templateName: string,
): Promise<boolean> {
  return templateName in (await getManifest()).templates;
}

export async function getIntegrationTemplate(
  integrationName: string,
): Promise<TemplateFile[] | null> {
  const entry = (await getManifest()).templates[`integration:${integrationName}`];
  if (!entry) return null;

  return getSortedFiles(entry);
}

export async function getAuthTemplate(
  presetName: string,
): Promise<TemplateFile[] | null> {
  const entry = (await getManifest()).templates[`auth:${presetName}`];
  if (!entry) return null;

  return getSortedFiles(entry);
}

export async function listTemplates(): Promise<string[]> {
  return Object.keys((await getManifest()).templates).filter(
    (name) => !name.startsWith("integration:") && !name.startsWith("auth:"),
  );
}

export async function listIntegrations(): Promise<string[]> {
  return Object.keys((await getManifest()).templates)
    .filter((name) => name.startsWith("integration:"))
    .map((name) => name.replace("integration:", ""));
}

export async function listAuthTemplates(): Promise<string[]> {
  return Object.keys((await getManifest()).templates)
    .filter((name) => name.startsWith("auth:"))
    .map((name) => name.replace("auth:", ""))
    .sort((a, b) => a.localeCompare(b));
}
