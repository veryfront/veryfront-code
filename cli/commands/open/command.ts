import { defineSchema, lazySchema } from "veryfront/schemas";
import type { InferSchema } from "veryfront/extensions/schema";
import { createArgParser } from "#cli/shared/args";
import { INVALID_ARGUMENT } from "veryfront/errors";

export const getOpenArgsSchema = defineSchema((v) =>
  v.object({
    env: v.string().optional(),
    studio: v.boolean().default(false),
    site: v.boolean().optional(),
    projectSlug: v.string().optional(),
  })
);

export const OpenArgsSchema = lazySchema(getOpenArgsSchema);

export type OpenOptions = InferSchema<ReturnType<typeof getOpenArgsSchema>>;

export const parseOpenArgs = createArgParser(OpenArgsSchema, {
  env: { keys: ["env"], type: "string" },
  studio: { keys: ["studio"], type: "boolean" },
  site: { keys: ["site"], type: "boolean" },
  projectSlug: { keys: ["project", "project-slug", "p"], type: "string" },
});

const DASHBOARD_BASE = "https://veryfront.com";

/** The environment `--site` targets when `--env` is absent. */
const DEFAULT_SITE_ENVIRONMENT = "production";

/**
 * A single DNS label. `--site` is the only `open` path that puts a resolved
 * value in the URL *authority* rather than its path, so it is the only one
 * where a stray `/`, `?`, or `#` changes the origin: `evil.example/x` would
 * build `https://evil.example/x.production.veryfront.com`, pushing the
 * hard-coded suffix into the path and leaving a link Veryfront does not own.
 * The slug is not always typed by the person running the command — it also
 * comes from `veryfront.json` and the local project link, which arrive with a
 * cloned repository — so it is validated rather than trusted.
 */
const SITE_HOSTNAME_LABEL_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i;

/** The longest a single DNS label may be, as `push` also enforces. */
const MAX_HOSTNAME_LABEL_LENGTH = 63;

function assertSiteHostnameLabel(value: string, label: string): void {
  if (
    SITE_HOSTNAME_LABEL_PATTERN.test(value) &&
    value.length <= MAX_HOSTNAME_LABEL_LENGTH
  ) {
    return;
  }

  throw INVALID_ARGUMENT.create({
    detail: `The ${label} "${value}" is not a DNS label, so it cannot name a deployed site. ` +
      `Use letters, digits, and hyphens only.`,
  });
}

/**
 * The canonical Veryfront Cloud address of a deployed environment, the same
 * `https://<slug>.<environment>.veryfront.com` form `deploy` falls back to when
 * an environment carries no custom domain. `open` has no API token, so it
 * cannot look a custom domain up; a project that has one reaches the same
 * deployment through both names.
 */
function buildSiteUrl(projectSlug: string, environment: string): string {
  assertSiteHostnameLabel(projectSlug, "project slug");
  assertSiteHostnameLabel(environment, "environment");
  return `https://${projectSlug}.${environment}.veryfront.com`;
}

export function buildUrl(projectSlug: string, options: OpenOptions): string {
  if (options.site) {
    return buildSiteUrl(projectSlug, options.env ?? DEFAULT_SITE_ENVIRONMENT);
  }
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
