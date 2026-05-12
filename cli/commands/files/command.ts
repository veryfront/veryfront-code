import { defineSchema } from "veryfront/schemas";
import type { InferSchema } from "veryfront/extensions/schema";
type SafeParseResult<T> = { success: true; data: T } | {
  success: false;
  error: Error & { issues: unknown[] };
};
import { createFileSystem } from "veryfront/platform";
import { dirname, normalize } from "veryfront/platform/path";
import { withSpan } from "veryfront/observability/otlp-setup";
import { cliLogger } from "#cli/utils";
import { type ApiClient, createApiClient, resolveConfigWithAuth } from "#cli/shared/config";
import type { ParsedArgs } from "#cli/shared/types";
import { getStringArg } from "../../shared/parsed-args.ts";
import { getFileContent, listAllFiles } from "../pull/command.ts";

const MAIN_SOURCE = { type: "main" } as const;

type RemoteFileEntry = Awaited<ReturnType<typeof listAllFiles>>[number];

const getFilesListArgsSchema = defineSchema((v) =>
  v.object({
    projectSlug: v.string().optional(),
    projectDir: v.string().optional(),
    path: v.string().optional(),
    json: v.boolean().default(false),
    quiet: v.boolean().default(false),
  })
);

const FilesListArgsSchema = getFilesListArgsSchema();

const getFilesGetArgsSchema = defineSchema((v) =>
  v.object({
    projectSlug: v.string().optional(),
    projectDir: v.string().optional(),
    remotePath: v.string().min(1),
    output: v.string().optional(),
    json: v.boolean().default(false),
    quiet: v.boolean().default(false),
  })
);

const FilesGetArgsSchema = getFilesGetArgsSchema();

const getFilesPutArgsSchema = defineSchema((v) =>
  v.object({
    projectSlug: v.string().optional(),
    projectDir: v.string().optional(),
    remotePath: v.string().min(1),
    from: v.string().min(1),
    json: v.boolean().default(false),
    quiet: v.boolean().default(false),
  })
);

const FilesPutArgsSchema = getFilesPutArgsSchema();

const getFilesDeleteArgsSchema = defineSchema((v) =>
  v.object({
    projectSlug: v.string().optional(),
    projectDir: v.string().optional(),
    remotePath: v.string().min(1),
    json: v.boolean().default(false),
    quiet: v.boolean().default(false),
  })
);

const FilesDeleteArgsSchema = getFilesDeleteArgsSchema();

export type FilesListOptions = InferSchema<ReturnType<typeof getFilesListArgsSchema>>;
export type FilesGetOptions = InferSchema<ReturnType<typeof getFilesGetArgsSchema>>;
export type FilesPutOptions = InferSchema<ReturnType<typeof getFilesPutArgsSchema>>;
export type FilesDeleteOptions = InferSchema<ReturnType<typeof getFilesDeleteArgsSchema>>;

function getBooleanArg(args: ParsedArgs, ...keys: string[]): boolean {
  return keys.some((key) => Boolean(args[key]));
}

function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

function showFilesUsage(): void {
  console.log(`
Veryfront Files

Usage:
  veryfront files list [options]
  veryfront files get <remote-path> [--output <local-file>] [options]
  veryfront files put <remote-path> --from <local-file> [options]
  veryfront files delete <remote-path> [options]

Subcommands:
  list     List project files
  get      Read a remote project file
  put      Upload a local file into the project files tree
  delete   Delete a remote project file
`);
}

function normalizeProjectFilePath(remotePath: string): string {
  const normalizedPath = normalize(remotePath).replace(/^\/+/, "");
  if (!normalizedPath || normalizedPath.startsWith("..") || normalizedPath.startsWith("/")) {
    throw new Error(`Invalid remote file path: ${remotePath}`);
  }
  return normalizedPath;
}

export function parseFilesListArgs(
  args: ParsedArgs,
): SafeParseResult<FilesListOptions> {
  return FilesListArgsSchema.safeParse({
    projectSlug: getStringArg(args, "project", "p", "project-slug"),
    projectDir: getStringArg(args, "project-dir", "dir", "d"),
    path: getStringArg(args, "path"),
    json: getBooleanArg(args, "json", "j"),
    quiet: getBooleanArg(args, "quiet", "q"),
  }) as SafeParseResult<FilesListOptions>;
}

export function parseFilesGetArgs(
  args: ParsedArgs,
): SafeParseResult<FilesGetOptions> {
  return FilesGetArgsSchema.safeParse({
    projectSlug: getStringArg(args, "project", "p", "project-slug"),
    projectDir: getStringArg(args, "project-dir", "dir", "d"),
    remotePath: typeof args._[2] === "string" ? args._[2] : "",
    output: getStringArg(args, "output", "o"),
    json: getBooleanArg(args, "json", "j"),
    quiet: getBooleanArg(args, "quiet", "q"),
  }) as SafeParseResult<FilesGetOptions>;
}

export function parseFilesPutArgs(
  args: ParsedArgs,
): SafeParseResult<FilesPutOptions> {
  return FilesPutArgsSchema.safeParse({
    projectSlug: getStringArg(args, "project", "p", "project-slug"),
    projectDir: getStringArg(args, "project-dir", "dir", "d"),
    remotePath: typeof args._[2] === "string" ? args._[2] : "",
    from: getStringArg(args, "from") ?? "",
    json: getBooleanArg(args, "json", "j"),
    quiet: getBooleanArg(args, "quiet", "q"),
  }) as SafeParseResult<FilesPutOptions>;
}

export function parseFilesDeleteArgs(
  args: ParsedArgs,
): SafeParseResult<FilesDeleteOptions> {
  return FilesDeleteArgsSchema.safeParse({
    projectSlug: getStringArg(args, "project", "p", "project-slug"),
    projectDir: getStringArg(args, "project-dir", "dir", "d"),
    remotePath: typeof args._[2] === "string" ? args._[2] : "",
    json: getBooleanArg(args, "json", "j"),
    quiet: getBooleanArg(args, "quiet", "q"),
  }) as SafeParseResult<FilesDeleteOptions>;
}

export function buildRemoteFileUrl(projectSlug: string, remotePath: string): string {
  const normalizedPath = normalizeProjectFilePath(remotePath);
  return `/projects/${projectSlug}/files/${encodeURIComponent(normalizedPath)}`;
}

export async function listRemoteFiles(
  client: ApiClient,
  projectSlug: string,
  options: Pick<FilesListOptions, "path"> = {},
): Promise<RemoteFileEntry[]> {
  const files = await listAllFiles(client, projectSlug, MAIN_SOURCE);
  if (!options.path) return files;
  return files.filter((file) => file.path.startsWith(options.path!));
}

export async function getRemoteFile(
  client: ApiClient,
  projectSlug: string,
  remotePath: string,
): Promise<string> {
  return getFileContent(client, projectSlug, normalizeProjectFilePath(remotePath), MAIN_SOURCE);
}

export async function putRemoteFileFromLocal(
  client: ApiClient,
  projectSlug: string,
  remotePath: string,
  localPath: string,
): Promise<{ path: string }> {
  const fs = createFileSystem();
  const content = await fs.readTextFile(localPath);
  const result = await client.put<{ path: string }>(buildRemoteFileUrl(projectSlug, remotePath), {
    content,
  });
  return { path: result.path ?? normalizeProjectFilePath(remotePath) };
}

export async function deleteRemoteFile(
  client: ApiClient,
  projectSlug: string,
  remotePath: string,
): Promise<void> {
  await client.delete(buildRemoteFileUrl(projectSlug, remotePath));
}

export async function filesCommand(args: ParsedArgs): Promise<void> {
  const subcommand = typeof args._[1] === "string" ? args._[1] : undefined;

  if (!subcommand || subcommand === "help") {
    showFilesUsage();
    return;
  }

  await withSpan("cli.command.files", async () => {
    switch (subcommand) {
      case "list": {
        const parsed = parseFilesListArgs(args);
        if (!parsed.success) {
          throw new Error(`Invalid files list arguments: ${parsed.error.message}`);
        }

        const options = parsed.data;
        let config = await resolveConfigWithAuth(options.projectDir);
        if (options.projectSlug) config = { ...config, projectSlug: options.projectSlug };

        const client = createApiClient(config);
        const files = await listRemoteFiles(client, config.projectSlug, options);

        if (options.json) {
          printJson(files);
          return;
        }

        if (!files.length) {
          cliLogger.info("No files found.");
          cliLogger.info("  Push files with: veryfront push");
          return;
        }

        for (const file of files) {
          console.log(file.path);
        }
        return;
      }

      case "get": {
        const parsed = parseFilesGetArgs(args);
        if (!parsed.success) {
          throw new Error(`Invalid files get arguments: ${parsed.error.message}`);
        }

        const options = parsed.data;
        let config = await resolveConfigWithAuth(options.projectDir);
        if (options.projectSlug) config = { ...config, projectSlug: options.projectSlug };

        const client = createApiClient(config);
        const content = await getRemoteFile(client, config.projectSlug, options.remotePath);

        if (options.output) {
          const fs = createFileSystem();
          await fs.mkdir(dirname(options.output), { recursive: true });
          await fs.writeTextFile(options.output, content);
          if (options.json) {
            printJson({
              path: normalizeProjectFilePath(options.remotePath),
              output: options.output,
            });
            return;
          }
          if (!options.quiet) {
            cliLogger.info(
              `Downloaded ${normalizeProjectFilePath(options.remotePath)} -> ${options.output}`,
            );
          }
          return;
        }

        if (options.json) {
          printJson({ path: normalizeProjectFilePath(options.remotePath), content });
          return;
        }

        console.log(content);
        return;
      }

      case "put": {
        const parsed = parseFilesPutArgs(args);
        if (!parsed.success) {
          throw new Error(`Invalid files put arguments: ${parsed.error.message}`);
        }

        const options = parsed.data;
        let config = await resolveConfigWithAuth(options.projectDir);
        if (options.projectSlug) config = { ...config, projectSlug: options.projectSlug };

        const client = createApiClient(config);
        const result = await putRemoteFileFromLocal(
          client,
          config.projectSlug,
          options.remotePath,
          options.from,
        );

        if (options.json) {
          printJson(result);
          return;
        }

        if (!options.quiet) {
          cliLogger.info(`Uploaded ${options.from} -> ${result.path}`);
        }
        return;
      }

      case "delete":
      case "rm": {
        const parsed = parseFilesDeleteArgs(args);
        if (!parsed.success) {
          throw new Error(`Invalid files delete arguments: ${parsed.error.message}`);
        }

        const options = parsed.data;
        let config = await resolveConfigWithAuth(options.projectDir);
        if (options.projectSlug) config = { ...config, projectSlug: options.projectSlug };

        const client = createApiClient(config);
        await deleteRemoteFile(client, config.projectSlug, options.remotePath);

        if (options.json) {
          printJson({ success: true, path: normalizeProjectFilePath(options.remotePath) });
          return;
        }

        if (!options.quiet) {
          cliLogger.info(`Deleted ${normalizeProjectFilePath(options.remotePath)}`);
        }
        return;
      }

      default:
        showFilesUsage();
    }
  });
}
