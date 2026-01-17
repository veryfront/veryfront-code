/**
 * Code Search Tool
 *
 * Searches through the codebase for specific patterns or text.
 * Uses grep to find matches with file names and line numbers.
 */

import { tool } from 'veryfront/tool';
import { z } from 'zod';
import * as child_process from 'node:child_process';
import * as util from 'node:util';

const execFile = util.promisify(child_process.execFile);

// Helper for Cross-Platform CWD
function getCwd(): string {
  // @ts-ignore - Deno global
  if (typeof Deno !== 'undefined') {
    // @ts-ignore - Deno global
    return Deno.cwd();
  }
  return process.cwd();
}

// Helper for Cross-Platform Command Execution
async function runCommand(command: string, args: string[], cwd: string): Promise<{ stdout: string; stderr: string; code: number }> {
  // @ts-ignore - Deno global
  if (typeof Deno !== 'undefined') {
    // @ts-ignore - Deno global
    const cmd = new Deno.Command(command, {
      args,
      cwd,
      stdout: 'piped',
      stderr: 'piped',
    });
    const output = await cmd.output();
    const decoder = new TextDecoder();
    return {
      stdout: decoder.decode(output.stdout),
      stderr: decoder.decode(output.stderr),
      code: output.code,
    };
  } else {
    try {
      const { stdout, stderr } = await execFile(command, args, { cwd });
      return { stdout: String(stdout), stderr: String(stderr), code: 0 };
    } catch (error: any) {
      // execFile throws on non-zero exit code
      return {
        stdout: String(error.stdout || ''),
        stderr: String(error.stderr || ''),
        code: error.code || 1,
      };
    }
  }
}

export default tool({
  description: 'Search for code patterns, function names, or text within the codebase. Returns matching files, line numbers, and context. Useful for finding function definitions, usages, imports, or specific code patterns.',

  inputSchema: z.object({
    query: z.string().describe('The search query (plain text or regex pattern)'),
    filePattern: z.string().optional().default('*.{ts,tsx,js,jsx}').describe('File pattern to search within (e.g., "*.ts", "src/**/*.tsx")'),
    caseSensitive: z.boolean().optional().default(false).describe('Whether the search should be case-sensitive'),
    maxResults: z.number().optional().default(20).describe('Maximum number of results to return'),
  }),

  execute: async ({ query, filePattern = '*.{ts,tsx,js,jsx}', caseSensitive = false, maxResults = 20 }) => {
    try {
      const baseDir = getCwd();

      // Build grep command with options
      const caseSensitiveFlag = caseSensitive ? '' : '-i';
      
      // Node.js execFile arguments need to be cleaned of empty strings strictly
      const grepArgs = [
        '-rn', // Recursive search with line numbers
        caseSensitiveFlag,
        '--include', filePattern, // File pattern filter
        '-H', // Always print filename
        query,
        '.',
      ].filter(arg => arg !== '');

      const { code, stdout, stderr } = await runCommand('grep', grepArgs, baseDir);

      // grep returns exit code 1 when no matches found (not an error)
      if (code !== 0 && code !== 1) {
        throw new Error(`grep failed: ${stderr}`);
      }

      const output = stdout;

      if (!output.trim()) {
        return {
          success: true,
          query,
          filePattern,
          results: [],
          totalMatches: 0,
          message: `No matches found for "${query}"`,
        };
      }

      // Parse grep output: format is "filename:line:content"
      const lines = output.trim().split('\n');
      const results = lines.slice(0, maxResults).map(line => {
        const match = line.match(/^([^:]+):(\d+):(.+)$/);
        if (!match) return null;

        const [, file, lineNum, content] = match;
        return {
          file: file.replace(/^\.\//, ''), // Remove leading ./
          line: parseInt(lineNum, 10),
          match: content.trim(),
        };
      }).filter(Boolean);

      return {
        success: true,
        query,
        filePattern,
        results,
        totalMatches: results.length,
        hasMore: lines.length > maxResults,
        message: `Found ${results.length} matches${lines.length > maxResults ? ` (showing first ${maxResults})` : ''} for "${query}"`,
      };
    } catch (error: any) {
      // If grep command not found, provide helpful error
      if (error instanceof Deno.errors.NotFound || error.code === 'ENOENT') {
        return {
          success: false,
          error: 'grep command not found. Please ensure grep is installed on your system.',
        };
      }

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  },
});
