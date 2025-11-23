/**
 * Read File Tool
 *
 * Reads the contents of a file from the codebase.
 * Uses secure path validation and returns content with line numbers.
 */

import { tool } from 'veryfront/ai';
import { z } from 'zod';
import { validateAndResolvePath, readFileContent } from '../utils/path-helpers.ts';

export default tool({
  description: 'Read the contents of a specific file from the codebase. Returns file content with line numbers and language detection. Useful for examining code, configuration files, and documentation.',

  inputSchema: z.object({
    filePath: z.string().describe('The path to the file to read (relative to project root)'),
    startLine: z.number().optional().describe('Optional: Start reading from this line number (1-indexed)'),
    endLine: z.number().optional().describe('Optional: Stop reading at this line number (inclusive)'),
  }),

  execute: async ({ filePath, startLine, endLine }) => {
    try {
      // Validate and resolve the file path
      const pathResult = validateAndResolvePath(filePath, {
        allowParentTraversal: false, // Security: prevent path traversal
      });

      if (!pathResult.success) {
        return {
          success: false,
          error: pathResult.error,
          filePath,
        };
      }

      // Read file contents with line range support
      const fileData = await readFileContent(pathResult.path!, {
        startLine,
        endLine,
      });

      return {
        success: true,
        filePath, // Return original input for clarity
        resolvedPath: pathResult.path,
        content: fileData.content,
        totalLines: fileData.totalLines,
        linesReturned: fileData.linesReturned,
        language: fileData.language,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        filePath,
      };
    }
  },
});
