import { defineSchema, lazySchema } from "veryfront/schemas";
import type { InferSchema } from "veryfront/extensions/schema";
import { createArgParser } from "#cli/shared/args";

export const getOpenArgsSchema = defineSchema((v) =>
  v.object({
    env: v.string().optional(),
    studio: v.boolean().default(false),
    projectSlug: v.string().optional(),
  })
);

export const OpenArgsSchema = lazySchema(getOpenArgsSchema);

export type OpenOptions = InferSchema<ReturnType<typeof getOpenArgsSchema>>;

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
