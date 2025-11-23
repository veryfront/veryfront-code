/**
 * Git Status Tool
 *
 * Gets the current git status of the repository using git commands.
 * Shows current branch, modified/staged/untracked files, and optionally diff stats.
 */

import { tool } from 'veryfront/ai';
import { z } from 'zod';

export default tool({
  description: 'Get the current git status of the repository including branch name, modified files, staged changes, and untracked files. Useful for understanding the current state of the codebase and recent changes.',

  inputSchema: z.object({
    showDiff: z.boolean().optional().default(false).describe('Whether to include diff statistics (lines added/deleted)'),
  }),

  execute: async ({ showDiff = false }) => {
    try {
      const baseDir = Deno.cwd();

      // Check if we're in a git repository
      const gitCheckCmd = new Deno.Command('git', {
        args: ['rev-parse', '--git-dir'],
        cwd: baseDir,
        stdout: 'piped',
        stderr: 'piped',
      });

      const gitCheckResult = await gitCheckCmd.output();
      if (gitCheckResult.code !== 0) {
        return {
          success: false,
          error: 'Not a git repository',
        };
      }

      // Get current branch
      const branchCmd = new Deno.Command('git', {
        args: ['branch', '--show-current'],
        cwd: baseDir,
        stdout: 'piped',
      });
      const branchResult = await branchCmd.output();
      const branch = new TextDecoder().decode(branchResult.stdout).trim();

      // Get git status in porcelain format for easy parsing
      const statusCmd = new Deno.Command('git', {
        args: ['status', '--porcelain'],
        cwd: baseDir,
        stdout: 'piped',
      });
      const statusResult = await statusCmd.output();
      const statusOutput = new TextDecoder().decode(statusResult.stdout);

      // Parse git status output
      const modified: string[] = [];
      const staged: string[] = [];
      const untracked: string[] = [];
      const deleted: string[] = [];

      statusOutput.trim().split('\n').forEach(line => {
        if (!line) return;

        const status = line.substring(0, 2);
        const file = line.substring(3);

        // First character is staged status, second is unstaged status
        const stagedStatus = status[0];
        const unstagedStatus = status[1];

        if (stagedStatus === 'M' || stagedStatus === 'A' || stagedStatus === 'R') {
          staged.push(file);
        }
        if (unstagedStatus === 'M') {
          modified.push(file);
        }
        if (stagedStatus === 'D' || unstagedStatus === 'D') {
          deleted.push(file);
        }
        if (status === '??') {
          untracked.push(file);
        }
      });

      const result: any = {
        success: true,
        branch,
        status: `On branch ${branch || '(detached HEAD)'}`,
        changes: {
          modified: modified.length,
          staged: staged.length,
          untracked: untracked.length,
          deleted: deleted.length,
        },
        files: {
          modified,
          staged,
          untracked,
          deleted,
        },
      };

      // Add diff statistics if requested
      if (showDiff && (modified.length > 0 || staged.length > 0)) {
        const diffCmd = new Deno.Command('git', {
          args: ['diff', '--shortstat'],
          cwd: baseDir,
          stdout: 'piped',
        });
        const diffResult = await diffCmd.output();
        const diffOutput = new TextDecoder().decode(diffResult.stdout).trim();

        // Parse: " 3 files changed, 145 insertions(+), 23 deletions(-)"
        const match = diffOutput.match(/(\d+) files? changed(?:, (\d+) insertions?\(\+\))?(?:, (\d+) deletions?\(-\))?/);

        if (match) {
          result.diff = {
            filesChanged: parseInt(match[1] || '0', 10),
            addedLines: parseInt(match[2] || '0', 10),
            deletedLines: parseInt(match[3] || '0', 10),
          };
        }
      }

      // Get ahead/behind information if there's an upstream branch
      try {
        const upstreamCmd = new Deno.Command('git', {
          args: ['rev-list', '--left-right', '--count', `${branch}...@{upstream}`],
          cwd: baseDir,
          stdout: 'piped',
          stderr: 'piped',
        });
        const upstreamResult = await upstreamCmd.output();

        if (upstreamResult.code === 0) {
          const upstreamOutput = new TextDecoder().decode(upstreamResult.stdout).trim();
          const [ahead, behind] = upstreamOutput.split(/\s+/).map(Number);
          result.upstream = { ahead, behind };

          if (ahead > 0 || behind > 0) {
            result.status += ` (${ahead > 0 ? `ahead ${ahead}` : ''}${ahead > 0 && behind > 0 ? ', ' : ''}${behind > 0 ? `behind ${behind}` : ''})`;
          }
        }
      } catch {
        // No upstream or error getting upstream info - not critical
      }

      return result;
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        return {
          success: false,
          error: 'git command not found. Please ensure git is installed on your system.',
        };
      }

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  },
});
