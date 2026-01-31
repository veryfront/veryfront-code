/**
 * Template loader using JSON manifest.
 *
 * Templates are compiled to a JSON manifest at build time, which allows
 * them to be embedded in compiled binaries without deno compile trying
 * to analyze them as TypeScript modules.
 */

import type { TemplateFile } from "./types.ts";
import manifest from "./manifest.json" with { type: "json" };

interface TemplateManifest {
  version: number;
  templates: Record<string, { files: Record<string, string> }>;
}

const typedManifest = manifest as TemplateManifest;

function getSortedFiles(entry: { files: Record<string, string> }): TemplateFile[] {
  return Object.entries(entry.files)
    .map(([path, content]) => ({ path, content }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

export function loadTemplateFromDirectory(
  templateName: string,
): Promise<TemplateFile[]> {
  const entry = typedManifest.templates[templateName];
  if (!entry) return Promise.resolve([]);

  return Promise.resolve(getSortedFiles(entry));
}

export function getTemplateDirectory(templateName: string): string {
  // For compatibility - returns a virtual path since templates are in manifest
  return `manifest://${templateName}`;
}

export function templateDirectoryExists(
  templateName: string,
): Promise<boolean> {
  return Promise.resolve(templateName in typedManifest.templates);
}

export function getIntegrationTemplate(
  integrationName: string,
): TemplateFile[] | null {
  const entry = typedManifest.templates[`integration:${integrationName}`];
  if (!entry) return null;

  return getSortedFiles(entry);
}

export function listTemplates(): string[] {
  return Object.keys(typedManifest.templates).filter(
    (name) => !name.startsWith("integration:"),
  );
}

export function listIntegrations(): string[] {
  return Object.keys(typedManifest.templates)
    .filter((name) => name.startsWith("integration:"))
    .map((name) => name.replace("integration:", ""));
}
