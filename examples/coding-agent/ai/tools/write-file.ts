/**
 * Write File Tool
 *
 * Writes content to a specified file in the codebase.
 * Uses secure path validation to prevent unauthorized access.
 */

import { tool } from 'veryfront/tool';
import { z } from 'zod';
import { validateAndResolvePath } from '../utils/path-helpers.ts';

// Conditional imports for file system operations
let fs: typeof import('node:fs/promises') | undefined;

// @ts-ignore - Deno global
if (typeof Deno === 'undefined') {
  fs = await import('node:fs/promises');
}

export default tool({
  description: 'Write content to a specified file. Can create new files or overwrite existing ones. Useful for modifying code, updating configurations, or generating new files.',

  inputSchema: z.object({
    filePath: z.string().describe('The path to the file to write (relative to project root)'),
    content: z.string().describe('The content to write to the file'),
    append: z.boolean().optional().default(false).describe('Whether to append content to the file instead of overwriting'),
  }),

  execute: async ({ filePath, content, append }) => {
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

      const resolvedPath = pathResult.path!;

      if (fs) {
        // Node.js file write
        await fs.writeFile(resolvedPath, content, { encoding: 'utf-8', flag: append ? 'a' : 'w' });
      } else {
        // Deno file write
        // @ts-ignore - Deno global
        await Deno.writeTextFile(resolvedPath, content, { append });
      }

      return {
        success: true,
        filePath,
        resolvedPath,
        message: `Content ${append ? 'appended to' : 'written to'} ${filePath}`,
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