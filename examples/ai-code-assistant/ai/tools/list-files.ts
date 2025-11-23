/**
 * List Files Tool
 *
 * Lists files in a directory with optional filtering.
 * Uses secure path validation to prevent unauthorized access.
 */

import { tool } from 'veryfront/ai';
import { z } from 'zod';
import { validateAndResolvePath, listDirectory } from '../utils/path-helpers.ts';

export default tool({
  description: 'List files in a directory. Useful for exploring project structure and understanding codebase organization.',

  inputSchema: z.object({
    directory: z.string().optional().default('.').describe('The directory path to list (relative to project root)'),
    pattern: z.string().optional().describe('Optional file pattern to filter (e.g., "*.ts", "**/*.tsx")'),
    includeHidden: z.boolean().optional().default(false).describe('Whether to include hidden files'),
  }),

  execute: async ({ directory = '.', pattern, includeHidden = false }) => {
    try {
      // Validate and resolve the directory path
      const pathResult = validateAndResolvePath(directory, {
        allowParentTraversal: false, // Security: prevent path traversal
      });

      if (!pathResult.success) {
        return {
          success: false,
          error: pathResult.error,
          directory,
        };
      }

      // List directory contents with filtering
      const files = await listDirectory(pathResult.path!, {
        includeHidden,
        pattern,
      });

      return {
        success: true,
        directory: directory, // Return original input path for clarity
        resolvedPath: pathResult.path,
        files,
        totalFiles: files.filter(f => f.type === 'file').length,
        totalDirectories: files.filter(f => f.type === 'directory').length,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        directory,
      };
    }
  },
});
