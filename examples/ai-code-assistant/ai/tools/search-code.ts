/**
 * Code Search Tool
 *
 * Searches through the codebase for specific patterns or text.
 * Uses grep to find matches with file names and line numbers.
 */

import { tool } from 'veryfront/ai';
import { z } from 'zod';

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
      const baseDir = Deno.cwd();

      // Build grep command with options
      const caseSensitiveFlag = caseSensitive ? '' : '-i';
      const command = new Deno.Command('grep', {
        args: [
          '-rn', // Recursive search with line numbers
          caseSensitiveFlag,
          '--include', filePattern, // File pattern filter
          '-H', // Always print filename
          query,
          '.',
        ].filter(Boolean), // Remove empty strings
        cwd: baseDir,
        stdout: 'piped',
        stderr: 'piped',
      });

      const { code, stdout, stderr } = await command.output();

      // grep returns exit code 1 when no matches found (not an error)
      if (code !== 0 && code !== 1) {
        const errorMsg = new TextDecoder().decode(stderr);
        throw new Error(`grep failed: ${errorMsg}`);
      }

      const output = new TextDecoder().decode(stdout);

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
    } catch (error) {
      // If grep command not found, provide helpful error
      if (error instanceof Deno.errors.NotFound) {
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
