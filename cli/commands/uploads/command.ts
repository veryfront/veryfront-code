import { z } from "zod";
import { createFileSystem, cwd, lookupMimeType } from "veryfront/platform";
import { dirname, join, normalize, resolve } from "veryfront/platform/path";
import { withSpan } from "veryfront/observability/otlp-setup";
import { cliLogger } from "#cli/utils";
import { type ApiClient, createApiClient, resolveConfigWithAuth } from "#cli/shared/config";
import type { ParsedArgs } from "#cli/shared/types";

export interface UploadItem {
  type: "file" | "folder";
  path: string;
  file_name?: string;
  size?: number;
  content_type?: string | null;
  status?: string;
  visibility?: string;
  created_at?: string;
  updated_at?: string;
}

interface UploadsListResponse {
  data: UploadItem[];
  page_info?: {
    next?: string | null;
    prev?: string | null;
  };
}

interface SignedUrlResponse {
  signed_url: string;
  expires_at: string;
}

interface CreateUploadResponse {
  file_upload_url: string;
  file_path: string;
  upload_id: string;
  required_headers: Record<string, string>;
}

const UploadListArgsSchema = z.object({
  projectSlug: z.string().optional(),
  projectDir: z.string().optional(),
  path: z.string().optional(),
  limit: z.coerce.number().min(1).max(100).optional(),
  recursive: z.boolean().default(true),
  json: z.boolean().default(false),
  quiet: z.boolean().default(false),
});

export type UploadListOptions = z.infer<typeof UploadListArgsSchema>;

const UploadPullArgsSchema = z.object({
  projectSlug: z.string().optional(),
  projectDir: z.string().optional(),
  uploads: z.array(z.string()).default([]),
  path: z.string().optional(),
  all: z.boolean().default(false),
  outputDir: z.string().default(join(cwd(), "uploads")),
  json: z.boolean().default(false),
  quiet: z.boolean().default(false),
});

export type UploadPullOptions = z.infer<typeof UploadPullArgsSchema>;

const UploadPutArgsSchema = z.object({
  projectSlug: z.string().optional(),
  projectDir: z.string().optional(),
  uploadPath: z.string().min(1),
  from: z.string().min(1),
  contentType: z.string().optional(),
  json: z.boolean().default(false),
  quiet: z.boolean().default(false),
});

export type UploadPutOptions = z.infer<typeof UploadPutArgsSchema>;

const UploadDeleteArgsSchema = z.object({
  projectSlug: z.string().optional(),
  projectDir: z.string().optional(),
  uploadPath: z.string().min(1),
  json: z.boolean().default(false),
  quiet: z.boolean().default(false),
});

export type UploadDeleteOptions = z.infer<typeof UploadDeleteArgsSchema>;

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

function formatUploadItem(item: UploadItem): string {
  if (item.type === "folder") return `[folder] ${item.path}`;
  const size = typeof item.size === "number" ? ` (${item.size} bytes)` : "";
  return `[file] ${item.path}${size}`;
}

function showUploadsUsage(): void {
  console.log(`
Veryfront Uploads

Usage:
  veryfront uploads list [options]
  veryfront uploads pull <upload-path...> [options]
  veryfront uploads pull --path <prefix> --all [options]
  veryfront uploads put <upload-path> --from <local-file> [options]
  veryfront uploads delete <upload-path> [options]

Subcommands:
  list     List uploads in the project uploads store
  pull     Download one or many uploads into a local directory
  put      Upload or replace a file in the project uploads store
  delete   Delete an upload by path
`);
}

function normalizeUploadPath(uploadPath: string): string {
  const normalizedPath = normalize(uploadPath).replace(/^\/+/, "");
  if (!normalizedPath || normalizedPath.startsWith("..") || normalizedPath.startsWith("/")) {
    throw new Error(`Invalid upload path: ${uploadPath}`);
  }
  return normalizedPath;
}

export function parseUploadsListArgs(
  args: ParsedArgs,
): z.SafeParseReturnType<unknown, UploadListOptions> {
  return UploadListArgsSchema.safeParse({
    projectSlug: getStringArg(args, "project", "p", "project-slug"),
    projectDir: getStringArg(args, "project-dir", "dir", "d"),
    path: getStringArg(args, "path"),
    limit: args.limit,
    recursive: args.recursive === undefined ? true : Boolean(args.recursive),
    json: getBooleanArg(args, "json", "j"),
    quiet: getBooleanArg(args, "quiet", "q"),
  });
}

export function parseUploadsPullArgs(
  args: ParsedArgs,
): z.SafeParseReturnType<unknown, UploadPullOptions> {
  return UploadPullArgsSchema.safeParse({
    projectSlug: getStringArg(args, "project", "p", "project-slug"),
    projectDir: getStringArg(args, "project-dir", "dir", "d"),
    uploads: args._.slice(2).filter((value): value is string => typeof value === "string"),
    path: getStringArg(args, "path"),
    all: getBooleanArg(args, "all"),
    outputDir: getStringArg(args, "output-dir") ?? join(cwd(), "uploads"),
    json: getBooleanArg(args, "json", "j"),
    quiet: getBooleanArg(args, "quiet", "q"),
  });
}

export function parseUploadsPutArgs(
  args: ParsedArgs,
): z.SafeParseReturnType<unknown, UploadPutOptions> {
  return UploadPutArgsSchema.safeParse({
    projectSlug: getStringArg(args, "project", "p", "project-slug"),
    projectDir: getStringArg(args, "project-dir", "dir", "d"),
    uploadPath: typeof args._[2] === "string" ? args._[2] : "",
    from: getStringArg(args, "from") ?? "",
    contentType: getStringArg(args, "content-type"),
    json: getBooleanArg(args, "json", "j"),
    quiet: getBooleanArg(args, "quiet", "q"),
  });
}

export function parseUploadsDeleteArgs(
  args: ParsedArgs,
): z.SafeParseReturnType<unknown, UploadDeleteOptions> {
  return UploadDeleteArgsSchema.safeParse({
    projectSlug: getStringArg(args, "project", "p", "project-slug"),
    projectDir: getStringArg(args, "project-dir", "dir", "d"),
    uploadPath: typeof args._[2] === "string" ? args._[2] : "",
    json: getBooleanArg(args, "json", "j"),
    quiet: getBooleanArg(args, "quiet", "q"),
  });
}

export function buildUploadsListUrl(projectSlug: string): string {
  return `/projects/${projectSlug}/uploads`;
}

export function buildUploadCreateUrl(projectSlug: string): string {
  return `/projects/${projectSlug}/uploads`;
}

export function buildUploadSignedUrlPath(projectSlug: string, uploadPath: string): string {
  return `/projects/${projectSlug}/uploads/${
    encodeURIComponent(normalizeUploadPath(uploadPath))
  }/url`;
}

function buildUploadDeleteUrl(projectSlug: string, uploadPath: string): string {
  return `/projects/${projectSlug}/uploads/${encodeURIComponent(normalizeUploadPath(uploadPath))}`;
}

export async function listAllUploads(
  client: ApiClient,
  projectSlug: string,
  options: Partial<Pick<UploadListOptions, "path" | "recursive" | "limit">> = {},
): Promise<UploadItem[]> {
  const allItems: UploadItem[] = [];
  let cursor: string | undefined;

  do {
    const params: Record<string, string> = {
      limit: String(options.limit ?? 100),
      recursive: String(options.recursive ?? true),
    };
    if (options.path) params.path = options.path;
    if (cursor) params.cursor = cursor;

    const response = await client.get<UploadsListResponse>(
      buildUploadsListUrl(projectSlug),
      params,
    );
    allItems.push(...response.data);
    cursor = response.page_info?.next ?? undefined;
  } while (cursor);

  return allItems;
}

export function resolveUploadOutputPath(uploadPath: string, outputDir: string): string {
  const normalizedPath = normalizeUploadPath(uploadPath);
  const fullPath = resolve(outputDir, normalizedPath);
  const resolvedOutputDir = resolve(outputDir);

  if (!fullPath.startsWith(`${resolvedOutputDir}/`) && fullPath !== resolvedOutputDir) {
    throw new Error(`Invalid upload path: ${uploadPath}`);
  }

  return fullPath;
}

export async function downloadUploadToFile(
  client: ApiClient,
  projectSlug: string,
  uploadPath: string,
  outputDir: string,
): Promise<{ uploadPath: string; localPath: string; bytes: number }> {
  const fs = createFileSystem();
  const signedUrl = await client.get<SignedUrlResponse>(
    buildUploadSignedUrlPath(projectSlug, uploadPath),
  );
  const response = await fetch(signedUrl.signed_url);

  if (!response.ok) {
    throw new Error(`Failed to download upload: ${uploadPath}`);
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  const localPath = resolveUploadOutputPath(uploadPath, outputDir);
  await fs.mkdir(dirname(localPath), { recursive: true });
  await fs.writeFile(localPath, bytes);

  return { uploadPath: normalizeUploadPath(uploadPath), localPath, bytes: bytes.byteLength };
}

export async function uploadLocalFileToUploads(
  client: ApiClient,
  projectSlug: string,
  uploadPath: string,
  localPath: string,
  contentType?: string,
): Promise<CreateUploadResponse> {
  const fs = createFileSystem();
  const normalizedPath = normalizeUploadPath(uploadPath);
  const bytes = await fs.readFile(localPath);
  const inferredContentType = contentType ?? lookupMimeType(localPath) ??
    "application/octet-stream";
  const createResponse = await client.post<CreateUploadResponse>(
    buildUploadCreateUrl(projectSlug),
    {
      file_path: normalizedPath,
      content_type: inferredContentType,
      size: bytes.byteLength,
    },
  );

  const uploadResponse = await fetch(createResponse.file_upload_url, {
    method: "PUT",
    headers: createResponse.required_headers,
    body: bytes as BodyInit,
  });

  if (!uploadResponse.ok) {
    throw new Error(`Failed to upload file to storage: ${normalizedPath}`);
  }

  return createResponse;
}

export async function deleteUpload(
  client: ApiClient,
  projectSlug: string,
  uploadPath: string,
): Promise<void> {
  await client.delete(buildUploadDeleteUrl(projectSlug, uploadPath));
}

export async function uploadsCommand(args: ParsedArgs): Promise<void> {
  const subcommand = typeof args._[1] === "string" ? args._[1] : undefined;

  if (!subcommand || subcommand === "help") {
    showUploadsUsage();
    return;
  }

  await withSpan("cli.command.uploads", async () => {
    switch (subcommand) {
      case "list": {
        const parsed = parseUploadsListArgs(args);
        if (!parsed.success) {
          throw new Error(`Invalid uploads list arguments: ${parsed.error.message}`);
        }

        const options = parsed.data;
        let config = await resolveConfigWithAuth(options.projectDir);
        if (options.projectSlug) config = { ...config, projectSlug: options.projectSlug };

        const client = createApiClient(config);
        const uploads = await listAllUploads(client, config.projectSlug, options);

        if (options.json) {
          printJson(uploads);
          return;
        }

        if (!uploads.length) {
          cliLogger.info("No uploads found.");
          return;
        }

        for (const upload of uploads) {
          console.log(formatUploadItem(upload));
        }
        return;
      }

      case "pull": {
        const parsed = parseUploadsPullArgs(args);
        if (!parsed.success) {
          throw new Error(`Invalid uploads pull arguments: ${parsed.error.message}`);
        }

        const options = parsed.data;
        let config = await resolveConfigWithAuth(options.projectDir);
        if (options.projectSlug) config = { ...config, projectSlug: options.projectSlug };

        const client = createApiClient(config);
        let targets = options.uploads;

        if (options.all) {
          const uploads = await listAllUploads(client, config.projectSlug, {
            path: options.path,
            recursive: true,
            limit: 100,
          });
          targets = uploads.filter((item) => item.type === "file").map((item) => item.path);
        }

        if (!targets.length) {
          throw new Error("No uploads selected. Pass upload paths or use --path with --all.");
        }

        const results = [] as Array<{ uploadPath: string; localPath: string; bytes: number }>;
        for (const uploadPath of targets) {
          const result = await downloadUploadToFile(
            client,
            config.projectSlug,
            uploadPath,
            options.outputDir,
          );
          results.push(result);
          if (!options.quiet && !options.json) {
            cliLogger.info(`Downloaded ${uploadPath} -> ${result.localPath}`);
          }
        }

        if (options.json) {
          printJson(results);
          return;
        }

        if (!options.quiet) {
          cliLogger.info(`Pulled ${results.length} upload(s) into ${options.outputDir}.`);
        }
        return;
      }

      case "put": {
        const parsed = parseUploadsPutArgs(args);
        if (!parsed.success) {
          throw new Error(`Invalid uploads put arguments: ${parsed.error.message}`);
        }

        const options = parsed.data;
        let config = await resolveConfigWithAuth(options.projectDir);
        if (options.projectSlug) config = { ...config, projectSlug: options.projectSlug };

        const client = createApiClient(config);
        const result = await uploadLocalFileToUploads(
          client,
          config.projectSlug,
          options.uploadPath,
          options.from,
          options.contentType,
        );

        if (options.json) {
          printJson(result);
          return;
        }

        if (!options.quiet) {
          cliLogger.info(`Uploaded ${options.from} -> ${normalizeUploadPath(options.uploadPath)}`);
        }
        return;
      }

      case "delete":
      case "rm": {
        const parsed = parseUploadsDeleteArgs(args);
        if (!parsed.success) {
          throw new Error(`Invalid uploads delete arguments: ${parsed.error.message}`);
        }

        const options = parsed.data;
        let config = await resolveConfigWithAuth(options.projectDir);
        if (options.projectSlug) config = { ...config, projectSlug: options.projectSlug };

        const client = createApiClient(config);
        await deleteUpload(client, config.projectSlug, options.uploadPath);

        if (options.json) {
          printJson({ success: true, path: normalizeUploadPath(options.uploadPath) });
          return;
        }

        if (!options.quiet) {
          cliLogger.info(`Deleted upload ${normalizeUploadPath(options.uploadPath)}`);
        }
        return;
      }

      default:
        showUploadsUsage();
    }
  });
}
