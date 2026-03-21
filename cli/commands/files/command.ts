import { z } from "zod";
import { createFileSystem } from "veryfront/platform";
import { dirname, normalize } from "veryfront/platform/path";
import { withSpan } from "veryfront/observability/otlp-setup";
import { cliLogger } from "#cli/utils";
import { type ApiClient, createApiClient, resolveConfigWithAuth } from "#cli/shared/config";
import type { ParsedArgs } from "#cli/shared/types";
import { getFileContent, listAllFiles } from "../pull/command.ts";

const MAIN_SOURCE = { type: "main" } as const;

type RemoteFileEntry = Awaited<ReturnType<typeof listAllFiles>>[number];

const FilesListArgsSchema = z.object({
  projectSlug: z.string().optional(),
  projectDir: z.string().optional(),
  path: z.string().optional(),
  json: z.boolean().default(false),
  quiet: z.boolean().default(false),
});

const FilesGetArgsSchema = z.object({
  projectSlug: z.string().optional(),
  projectDir: z.string().optional(),
  remotePath: z.string().min(1),
  output: z.string().optional(),
  json: z.boolean().default(false),
  quiet: z.boolean().default(false),
});

const FilesPutArgsSchema = z.object({
  projectSlug: z.string().optional(),
  projectDir: z.string().optional(),
  remotePath: z.string().min(1),
  from: z.string().min(1),
  json: z.boolean().default(false),
  quiet: z.boolean().default(false),
});

const FilesDeleteArgsSchema = z.object({
  projectSlug: z.string().optional(),
  projectDir: z.string().optional(),
  remotePath: z.string().min(1),
  json: z.boolean().default(false),
  quiet: z.boolean().default(false),
});

export type FilesListOptions = z.infer<typeof FilesListArgsSchema>;
export type FilesGetOptions = z.infer<typeof FilesGetArgsSchema>;
export type FilesPutOptions = z.infer<typeof FilesPutArgsSchema>;
export type FilesDeleteOptions = z.infer<typeof FilesDeleteArgsSchema>;

function getStringArg(args: ParsedArgs, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = args[key];
    if (typeof value === "string" && value) return value;
  }
  return undefined;
}

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
): z.SafeParseReturnType<unknown, FilesListOptions> {
  return FilesListArgsSchema.safeParse({
    projectSlug: getStringArg(args, "project", "p", "project-slug"),
    projectDir: getStringArg(args, "project-dir", "dir", "d"),
    path: getStringArg(args, "path"),
    json: getBooleanArg(args, "json", "j"),
    quiet: getBooleanArg(args, "quiet", "q"),
  });
}

export function parseFilesGetArgs(
  args: ParsedArgs,
): z.SafeParseReturnType<unknown, FilesGetOptions> {
  return FilesGetArgsSchema.safeParse({
    projectSlug: getStringArg(args, "project", "p", "project-slug"),
    projectDir: getStringArg(args, "project-dir", "dir", "d"),
    remotePath: typeof args._[2] === "string" ? args._[2] : "",
    output: getStringArg(args, "output", "o"),
    json: getBooleanArg(args, "json", "j"),
    quiet: getBooleanArg(args, "quiet", "q"),
  });
}

export function parseFilesPutArgs(
  args: ParsedArgs,
): z.SafeParseReturnType<unknown, FilesPutOptions> {
  return FilesPutArgsSchema.safeParse({
    projectSlug: getStringArg(args, "project", "p", "project-slug"),
    projectDir: getStringArg(args, "project-dir", "dir", "d"),
    remotePath: typeof args._[2] === "string" ? args._[2] : "",
    from: getStringArg(args, "from") ?? "",
    json: getBooleanArg(args, "json", "j"),
    quiet: getBooleanArg(args, "quiet", "q"),
  });
}

export function parseFilesDeleteArgs(
  args: ParsedArgs,
): z.SafeParseReturnType<unknown, FilesDeleteOptions> {
  return FilesDeleteArgsSchema.safeParse({
    projectSlug: getStringArg(args, "project", "p", "project-slug"),
    projectDir: getStringArg(args, "project-dir", "dir", "d"),
    remotePath: typeof args._[2] === "string" ? args._[2] : "",
    json: getBooleanArg(args, "json", "j"),
    quiet: getBooleanArg(args, "quiet", "q"),
  });
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
