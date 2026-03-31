import { z } from "zod";
import { createArgParser } from "#cli/shared/args";

export const OpenArgsSchema = z.object({
  env: z.string().optional(),
  studio: z.boolean().default(false),
  projectSlug: z.string().optional(),
});

export type OpenOptions = z.infer<typeof OpenArgsSchema>;

export const parseOpenArgs = createArgParser(OpenArgsSchema, {
  env: { keys: ["env"], type: "string" },
  studio: { keys: ["studio"], type: "boolean" },
  projectSlug: { keys: ["project-slug", "project", "p"], type: "string" },
});

const DASHBOARD_BASE = "https://veryfront.com";

export function buildUrl(projectSlug: string, options: OpenOptions): string {
  if (options.studio) {
    return `${DASHBOARD_BASE}/studio/${projectSlug}`;
  }
  if (options.env) {
    return `${DASHBOARD_BASE}/projects/${projectSlug}/environments/${options.env}`;
  }
  return `${DASHBOARD_BASE}/projects/${projectSlug}`;
}
