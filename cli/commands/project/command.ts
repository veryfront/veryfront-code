import { defineSchema, lazySchema } from "veryfront/schemas";
import type { InferSchema } from "veryfront/extensions/schema";

type SafeParseResult<T> = { success: true; data: T } | {
  success: false;
  error: Error & { issues: unknown[] };
};

import { withSpan } from "veryfront/observability/otlp-setup";
import { INVALID_ARGUMENT } from "veryfront/errors";
import { cliLogger, confirmPrompt } from "#cli/utils";
import { parseArgsOrThrow } from "#cli/shared/args";
import { type ApiClient, createApiClient, resolveConfigWithAuth } from "#cli/shared/config";
import type { ParsedArgs } from "#cli/shared/types";
import { createSuccessEnvelope, outputJson } from "../../shared/json-output.ts";
import { getBooleanArg, getStringArg } from "../../shared/parsed-args.ts";

const getProjectDeleteArgsSchema = defineSchema((v) =>
  v.object({
    projectSlug: v.string().optional(),
    projectDir: v.string().optional(),
    force: v.boolean().default(false),
    json: v.boolean().default(false),
    quiet: v.boolean().default(false),
  })
);

const ProjectDeleteArgsSchema = lazySchema(getProjectDeleteArgsSchema);

export type ProjectDeleteOptions = InferSchema<ReturnType<typeof getProjectDeleteArgsSchema>>;

function showProjectUsage(): void {
  console.log(`
Veryfront Project

Usage:
  veryfront project delete [slug] [options]

Subcommands:
  delete   Delete a cloud project and everything it owns
`);
}

export function parseProjectDeleteArgs(
  args: ParsedArgs,
): SafeParseResult<ProjectDeleteOptions> {
  const positional = typeof args._[2] === "string" ? args._[2] : undefined;
  return ProjectDeleteArgsSchema.safeParse({
    projectSlug: positional ?? getStringArg(args, "project", "p", "project-slug"),
    projectDir: getStringArg(args, "project-dir", "dir", "d"),
    force: getBooleanArg(args, "force", "f"),
    json: getBooleanArg(args, "json", "j"),
    quiet: getBooleanArg(args, "quiet", "q"),
  }) as SafeParseResult<ProjectDeleteOptions>;
}

export function buildProjectDeleteUrl(projectReference: string): string {
  const reference = projectReference.trim();
  if (!reference) {
    throw INVALID_ARGUMENT.create({
      detail: "Invalid project reference: a project slug or id is required",
    });
  }
  return `/projects/${encodeURIComponent(reference)}`;
}

export async function deleteRemoteProject(
  client: ApiClient,
  projectReference: string,
): Promise<void> {
  await client.delete(buildProjectDeleteUrl(projectReference));
}

export async function projectCommand(args: ParsedArgs): Promise<void> {
  const subcommand = typeof args._[1] === "string" ? args._[1] : undefined;

  if (!subcommand || subcommand === "help") {
    showProjectUsage();
    return;
  }

  await withSpan("cli.command.project", async () => {
    switch (subcommand) {
      case "delete":
      case "rm": {
        const options = parseArgsOrThrow(parseProjectDeleteArgs, "project delete", args);
        const config = await resolveConfigWithAuth(options.projectDir);
        const projectSlug = options.projectSlug ?? config.projectSlug;

        if (!options.force) {
          const confirmed = await confirmPrompt(
            `Delete project "${projectSlug}"? Environments, releases, files, and uploads go with it.`,
            false,
          );
          if (!confirmed) {
            if (options.json) {
              await outputJson(createSuccessEnvelope("project", {
                project: projectSlug,
                deleted: false,
                cancelled: true,
              }));
              return;
            }
            cliLogger.info("Delete cancelled.");
            return;
          }
        }

        const client = createApiClient({ ...config, projectSlug });
        await deleteRemoteProject(client, projectSlug);

        if (options.json) {
          await outputJson(createSuccessEnvelope("project", {
            project: projectSlug,
            deleted: true,
          }));
          return;
        }

        if (!options.quiet) {
          cliLogger.info(`Deleted project ${projectSlug}`);
        }
        return;
      }

      default:
        // A cleanup script must not read a typo as a successful teardown, so an
        // unknown subcommand is a usage error rather than a printed usage block.
        throw INVALID_ARGUMENT.create({
          detail:
            `Unknown project subcommand: ${subcommand}. Usage: veryfront project delete [slug]`,
        });
    }
  });
}
