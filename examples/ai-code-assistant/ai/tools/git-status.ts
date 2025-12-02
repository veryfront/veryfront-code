/**
 * Git Status Tool
 *
 * Gets the current git status of the repository using git commands.
 * Shows current branch, modified/staged/untracked files, and optionally diff stats.
 */

import { tool } from 'veryfront/ai';
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
      return {
        stdout: String(error.stdout || ''),
        stderr: String(error.stderr || ''),
        code: error.code || 1,
      };
    }
  }
}

export default tool({
  description: 'Get the current git status of the repository including branch name, modified files, staged changes, and untracked files. Useful for understanding the current state of the codebase and recent changes.',

  inputSchema: z.object({
    showDiff: z.boolean().optional().default(false).describe('Whether to include diff statistics (lines added/deleted)'),
  }),

  execute: async ({ showDiff = false }) => {
    try {
      const baseDir = getCwd();

      // Check if we're in a git repository
      const gitCheckResult = await runCommand('git', ['rev-parse', '--git-dir'], baseDir);
      
      if (gitCheckResult.code !== 0) {
        return {
          success: false,
          error: 'Not a git repository',
        };
      }

      // Get current branch
      const branchResult = await runCommand('git', ['branch', '--show-current'], baseDir);
      const branch = branchResult.stdout.trim();

      // Get git status in porcelain format for easy parsing
      const statusResult = await runCommand('git', ['status', '--porcelain'], baseDir);
      const statusOutput = statusResult.stdout;

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
        const diffResult = await runCommand('git', ['diff', '--shortstat'], baseDir);
        const diffOutput = diffResult.stdout.trim();

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
        const upstreamResult = await runCommand('git', ['rev-list', '--left-right', '--count', `${branch}...@{upstream}`], baseDir);

        if (upstreamResult.code === 0) {
          const upstreamOutput = upstreamResult.stdout.trim();
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
    } catch (error: any) {
      if (error instanceof Deno.errors.NotFound || error.code === 'ENOENT') {
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
