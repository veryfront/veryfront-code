/**
 * Path Security Utilities
 *
 * Provides secure path validation and file system operations
 * to prevent path traversal attacks and unauthorized access.
 */

import { resolve, normalize, isAbsolute, join } from 'https://deno.land/std@0.224.0/path/mod.ts';

export interface PathValidationOptions {
  baseDir?: string;
  allowAbsolute?: boolean;
  allowParentTraversal?: boolean;
}

export interface PathValidationResult {
  success: boolean;
  path?: string;
  error?: string;
}

/**
 * Validates and resolves a path relative to a base directory.
 * Prevents path traversal attacks by ensuring the resolved path
 * stays within the allowed base directory.
 */
export function validateAndResolvePath(
  inputPath: string,
  options: PathValidationOptions = {}
): PathValidationResult {
  const {
    baseDir = Deno.cwd(),
    allowAbsolute = false,
    allowParentTraversal = false,
  } = options;

  // Reject absolute paths if not allowed
  if (isAbsolute(inputPath) && !allowAbsolute) {
    return {
      success: false,
      error: 'Absolute paths are not allowed for security reasons',
    };
  }

  // Resolve the path relative to base directory
  const resolved = resolve(baseDir, inputPath);
  const normalized = normalize(resolved);

  // Check for path traversal outside base directory
  if (!allowParentTraversal && !normalized.startsWith(baseDir)) {
    return {
      success: false,
      error: `Path traversal outside base directory is not allowed (attempted: ${inputPath})`,
    };
  }

  return { success: true, path: normalized };
}

export interface FileEntry {
  name: string;
  type: 'file' | 'directory';
  size: number | null;
}

export interface ListDirectoryOptions {
  includeHidden?: boolean;
  pattern?: string;
}

/**
 * Safely lists directory contents with optional filtering.
 * Returns file entries with type and size information.
 */
export async function listDirectory(
  directory: string,
  options: ListDirectoryOptions = {}
): Promise<FileEntry[]> {
  const { includeHidden = false, pattern } = options;
  const entries: FileEntry[] = [];

  try {
    for await (const entry of Deno.readDir(directory)) {
      // Skip hidden files if not requested
      if (!includeHidden && entry.name.startsWith('.')) {
        continue;
      }

      // Apply pattern filter if provided (simple glob matching)
      if (pattern && !matchesPattern(entry.name, pattern)) {
        continue;
      }

      // Get file stats for size information
      const entryPath = join(directory, entry.name);
      const stat = await Deno.stat(entryPath);

      entries.push({
        name: entry.name,
        type: entry.isDirectory ? 'directory' : 'file',
        size: entry.isFile ? stat.size : null,
      });
    }

    // Sort: directories first, then files, both alphabetically
    return entries.sort((a, b) => {
      if (a.type !== b.type) {
        return a.type === 'directory' ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      throw new Error(`Directory not found: ${directory}`);
    }
    if (error instanceof Deno.errors.PermissionDenied) {
      throw new Error(`Permission denied accessing: ${directory}`);
    }
    throw error;
  }
}

/**
 * Simple pattern matching for file names.
 * Supports basic wildcards: * (any characters), ? (single character)
 * and **\/ for recursive directory matching.
 */
function matchesPattern(filename: string, pattern: string): boolean {
  // Convert glob pattern to regex
  // Escape special regex characters except * and ?
  const regexPattern = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');

  const regex = new RegExp(`^${regexPattern}$`);
  return regex.test(filename);
}

export interface ReadFileOptions {
  encoding?: 'utf-8' | 'binary';
  startLine?: number;
  endLine?: number;
}

/**
 * Safely reads a file with optional line range selection.
 * Returns file content with metadata.
 */
export async function readFileContent(
  filePath: string,
  options: ReadFileOptions = {}
): Promise<{
  content: string;
  totalLines: number;
  linesReturned: number;
  language: string;
}> {
  const { encoding = 'utf-8', startLine, endLine } = options;

  try {
    // Read file content
    const content = await Deno.readTextFile(filePath);
    const lines = content.split('\n');

    // Apply line range if specified
    const start = startLine ? Math.max(0, startLine - 1) : 0;
    const end = endLine ? Math.min(lines.length, endLine) : lines.length;

    // Add line numbers to content
    const selectedLines = lines.slice(start, end);
    const numberedContent = selectedLines
      .map((line, idx) => `${start + idx + 1}  ${line}`)
      .join('\n');

    // Detect language from file extension
    const language = detectLanguage(filePath);

    return {
      content: numberedContent,
      totalLines: lines.length,
      linesReturned: selectedLines.length,
      language,
    };
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      throw new Error(`File not found: ${filePath}`);
    }
    if (error instanceof Deno.errors.PermissionDenied) {
      throw new Error(`Permission denied reading: ${filePath}`);
    }
    throw error;
  }
}

/**
 * Detects programming language from file extension
 */
function detectLanguage(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase();

  const languageMap: Record<string, string> = {
    'ts': 'typescript',
    'tsx': 'tsx',
    'js': 'javascript',
    'jsx': 'jsx',
    'py': 'python',
    'rs': 'rust',
    'go': 'go',
    'java': 'java',
    'c': 'c',
    'cpp': 'cpp',
    'h': 'c',
    'hpp': 'cpp',
    'cs': 'csharp',
    'rb': 'ruby',
    'php': 'php',
    'swift': 'swift',
    'kt': 'kotlin',
    'scala': 'scala',
    'sh': 'bash',
    'bash': 'bash',
    'zsh': 'bash',
    'json': 'json',
    'yaml': 'yaml',
    'yml': 'yaml',
    'toml': 'toml',
    'xml': 'xml',
    'html': 'html',
    'css': 'css',
    'scss': 'scss',
    'sass': 'sass',
    'md': 'markdown',
    'sql': 'sql',
  };

  return languageMap[ext || ''] || 'text';
}
