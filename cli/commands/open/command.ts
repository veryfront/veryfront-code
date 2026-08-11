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
  projectSlug: { keys: ["project", "project-slug", "p"], type: "string" },
});

const DASHBOARD_BASE = "https://veryfront.com";

export function buildUrl(projectSlug: string, options: OpenOptions): string {
  if (options.studio) {
    return `${DASHBOARD_BASE}/studio/${projectSlug}`;
  }
  // Environments are a panel on the project page, not a route of their own —
  // `/projects/<slug>/environments/<name>` is a hard 404. The panel is opened
  // with `?panels=<panelId>`. The panel's own deep link seeds a selection by
  // environment *id* (`?environments=edit:<id>`), which `open` cannot resolve
  // from a name without an API token, so the env name selects the panel only.
  if (options.env) {
    return `${DASHBOARD_BASE}/projects/${projectSlug}?panels=environments`;
  }
  return `${DASHBOARD_BASE}/projects/${projectSlug}`;
}
