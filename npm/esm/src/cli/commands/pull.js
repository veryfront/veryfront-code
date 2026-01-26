/**
 * Pull command - Download project files from Veryfront API
 *
 * Downloads all files from the remote Veryfront project using the files API
 * and writes them to the local filesystem with their original paths.
 *
 * @module cli/commands/pull
 */
import { dirname, join, normalize, resolve } from "../../platform/compat/path/index.js";
import { cliLogger } from "../../utils/index.js";
import { cwd } from "../../platform/compat/process.js";
import { createFileSystem } from "../../platform/compat/fs.js";
import { createApiClient, readConfigFile, resolveConfig, } from "../shared/config.js";
import { confirmPrompt, createNoopSpinner, createSpinner, logInfo, logSuccess, logWarning, } from "../utils/index.js";
import { getApiTokenEnv } from "../../config/env.js";
import { withSpan } from "../../observability/tracing/otlp-setup.js";
/**
 * Resolve pull source from options
 * Priority: env > release > branch > main
 */
export function resolvePullSource(options) {
    if (options.env)
        return { type: "environment", name: options.env };
    if (options.release)
        return { type: "release", version: options.release };
    if (options.branch && options.branch !== "main")
        return { type: "branch", name: options.branch };
    return { type: "main" };
}
/**
 * Validate and sanitize file path to prevent path traversal attacks.
 * Ensures the resolved path is within the project directory.
 *
 * @param filePath - The file path from API to validate
 * @param projectDir - The project directory base path
 * @returns Sanitized absolute path
 * @throws Error if path attempts to escape project directory
 */
function validateFilePath(filePath, projectDir) {
    const normalizedPath = normalize(filePath);
    if (normalizedPath.startsWith("/") || normalizedPath.startsWith("..")) {
        throw new Error(`Invalid file path: "${filePath}" - paths must be relative and cannot escape project directory`);
    }
    const fullPath = resolve(projectDir, normalizedPath);
    const resolvedProjectDir = resolve(projectDir);
    if (!fullPath.startsWith(resolvedProjectDir + "/") && fullPath !== resolvedProjectDir) {
        throw new Error(`Invalid file path: "${filePath}" - resolved path escapes project directory`);
    }
    return fullPath;
}
/**
 * Build the files list URL based on pull source
 */
export function buildFilesListUrl(projectSlug, source) {
    switch (source.type) {
        case "environment":
            return `/projects/${projectSlug}/environments/${encodeURIComponent(source.name)}/files`;
        case "release":
            return `/projects/${projectSlug}/releases/${encodeURIComponent(source.version)}/files`;
        case "branch":
            return `/projects/${projectSlug}/branches/${encodeURIComponent(source.name)}/files`;
        case "main":
            return `/projects/${projectSlug}/files`;
    }
}
/**
 * Fetch all files from API with pagination
 * Supports main, branch, environment, and release sources
 */
export async function listAllFiles(client, projectSlug, source) {
    const allFiles = [];
    let cursor;
    const url = buildFilesListUrl(projectSlug, source);
    do {
        const params = {
            limit: "100",
            sort_by: "updated_at",
            sort_order: "desc",
            ...(cursor ? { cursor } : {}),
        };
        const response = await client.get(url, params);
        allFiles.push(...response.data);
        cursor = response.page_info?.next;
    } while (cursor);
    return allFiles;
}
/**
 * Build the file content URL based on pull source
 */
export function buildFileContentUrl(projectSlug, path, source) {
    const encodedPath = encodeURIComponent(path);
    switch (source.type) {
        case "environment":
            return `/projects/${projectSlug}/environments/${encodeURIComponent(source.name)}/files/${encodedPath}`;
        case "release":
            return `/projects/${projectSlug}/releases/${encodeURIComponent(source.version)}/files/${encodedPath}`;
        case "branch":
            return `/projects/${projectSlug}/branches/${encodeURIComponent(source.name)}/files/${encodedPath}`;
        case "main":
            return `/projects/${projectSlug}/files/${encodedPath}`;
    }
}
/**
 * Get file content from API
 * Supports main, branch, environment, and release sources
 */
export async function getFileContent(client, projectSlug, path, source) {
    const url = buildFileContentUrl(projectSlug, path, source);
    const response = await client.get(url);
    // Ensure text files end with a trailing newline (POSIX standard)
    const content = response.content;
    if (content && !content.endsWith("\n"))
        return content + "\n";
    return content;
}
/** Concurrency limit for parallel file fetches */
const CONCURRENCY = 20;
async function processFile(op, client, projectSlug, source, fs) {
    try {
        const content = await getFileContent(client, projectSlug, op.relativePath, source);
        await fs.mkdir(dirname(op.path), { recursive: true });
        await fs.writeTextFile(op.path, content);
        return { success: true, path: op.relativePath };
    }
    catch (error) {
        return { success: false, path: op.relativePath, error: error };
    }
}
async function writeFiles(ops, client, projectSlug, source, dryRun) {
    if (dryRun) {
        for (const op of ops)
            cliLogger.info(`  Would write: ${op.relativePath}`);
        return { written: ops.length, skipped: 0 };
    }
    const fs = createFileSystem();
    let written = 0;
    let skipped = 0;
    const results = [];
    for (let i = 0; i < ops.length; i += CONCURRENCY) {
        const batch = ops.slice(i, i + CONCURRENCY);
        results.push(...(await Promise.all(batch.map((op) => processFile(op, client, projectSlug, source, fs)))));
    }
    for (const result of results) {
        if (result.success) {
            written++;
            continue;
        }
        cliLogger.error(`Failed to write ${result.path}:`, result.error);
        skipped++;
    }
    return { written, skipped };
}
function formatPullSource(source) {
    switch (source.type) {
        case "environment":
            return `environment: ${source.name}`;
        case "release":
            return `release: ${source.version}`;
        case "branch":
            return `branch: ${source.name}`;
        case "main":
            return "main";
    }
}
async function pullSingleProject(projectSlug, projectDir, source, force, dryRun, config, quiet = false) {
    const sourceLabel = formatPullSource(source);
    const spinner = quiet
        ? createNoopSpinner()
        : createSpinner(`Fetching files from ${projectSlug} (${sourceLabel})...`);
    spinner.start();
    const client = createApiClient({ ...config, projectSlug });
    let files;
    try {
        files = await listAllFiles(client, projectSlug, source);
    }
    finally {
        spinner.stop();
    }
    if (files.length === 0) {
        if (!quiet)
            logInfo(`No files to pull from ${projectSlug}.`);
        return { written: 0, skipped: 0 };
    }
    const writeOps = files
        .map((file) => {
        try {
            return { path: validateFilePath(file.path, projectDir), relativePath: file.path };
        }
        catch (error) {
            if (!quiet)
                cliLogger.warn(`Skipping invalid file path: ${file.path}`, error);
            return null;
        }
    })
        .filter((op) => op !== null);
    if (!quiet) {
        cliLogger.info(`\nFound ${files.length} files to ${dryRun ? "pull" : "write"} from ${projectSlug}.`);
    }
    if (!force && !dryRun) {
        const confirmed = await confirmPrompt(`This will overwrite local files in ${projectDir}. Continue?`, false);
        if (!confirmed) {
            cliLogger.info("Pull cancelled.");
            return { written: 0, skipped: 0 };
        }
    }
    spinner.start();
    spinner.update(`Writing files to ${projectDir}...`);
    const result = await writeFiles(writeOps, client, projectSlug, source, dryRun);
    spinner.stop();
    if (!quiet) {
        if (dryRun) {
            logInfo(`Dry run complete for ${projectSlug}. Would write ${result.written} files.`);
        }
        else {
            logSuccess(`Pulled ${result.written} files from ${projectSlug} (${sourceLabel}).`);
            if (result.skipped > 0)
                logWarning(`Skipped ${result.skipped} files due to errors.`);
        }
    }
    return result;
}
/**
 * Pull files from Veryfront API
 */
export function pullCommand(options = {}) {
    const source = resolvePullSource(options);
    return withSpan("cli.command.pull", async () => {
        const { projectSlug: slugOverride, projects: projectsOverride, projectDir = cwd(), force = false, dryRun = false, quiet = false, } = options;
        const spinner = quiet ? createNoopSpinner() : createSpinner("Resolving configuration...");
        spinner.start();
        const configFile = await readConfigFile(projectDir);
        const projects = projectsOverride ?? configFile?.projects;
        let config;
        try {
            config = await resolveConfig(projectDir);
            if (slugOverride)
                config = { ...config, projectSlug: slugOverride };
        }
        catch (error) {
            spinner.stop();
            if (!projects?.length)
                throw error;
            const token = getApiTokenEnv() ?? configFile?.apiToken;
            if (!token) {
                throw new Error("VERYFRONT_API_TOKEN environment variable or apiToken in .veryfrontrc is required when using --projects");
            }
            config = {
                apiUrl: configFile?.apiUrl ?? "https://api.veryfront.com",
                apiToken: token,
                projectSlug: "",
            };
        }
        spinner.stop();
        if (projects?.length) {
            const fs = createFileSystem();
            let totalWritten = 0;
            let totalSkipped = 0;
            for (const project of projects) {
                const targetDir = join(projectDir, project);
                if (!dryRun)
                    await fs.mkdir(targetDir, { recursive: true });
                if (!quiet)
                    cliLogger.info(`\n--- Pulling ${project} into ${targetDir} ---`);
                try {
                    const result = await pullSingleProject(project, targetDir, source, force, dryRun, config, quiet);
                    totalWritten += result.written;
                    totalSkipped += result.skipped;
                }
                catch (error) {
                    cliLogger.error(`Failed to pull ${project}:`, error);
                    totalSkipped++;
                }
            }
            if (!quiet) {
                cliLogger.info("");
                if (dryRun) {
                    logInfo(`Dry run complete. Would write ${totalWritten} files total across ${projects.length} projects.`);
                }
                else {
                    logSuccess(`Pulled ${totalWritten} files total across ${projects.length} projects.`);
                    if (totalSkipped > 0)
                        logWarning(`Skipped ${totalSkipped} files due to errors.`);
                }
            }
            return;
        }
        await pullSingleProject(config.projectSlug, projectDir, source, force, dryRun, config, quiet);
    }, { "cli.dryRun": options.dryRun ?? false, "cli.source_type": source.type });
}
