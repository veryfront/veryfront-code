/**
 * MCP tool for production builds.
 */

import { z } from "zod";
import { cwd } from "veryfront/platform";
import { join } from "veryfront/platform/path";
import { buildProduction } from "veryfront/build";
import { withSpan } from "veryfront/observability/otlp-setup";
import type { MCPTool } from "../tools.ts";

// ============================================================================
// Tool: vf_build
// ============================================================================

const buildInput = z.object({
  outputDir: z
    .string()
    .optional()
    .describe("Output directory for the build. Defaults to '<projectDir>/dist'."),
  splitting: z
    .boolean()
    .optional()
    .default(true)
    .describe("Enable code splitting. Defaults to true."),
  compress: z
    .boolean()
    .optional()
    .default(true)
    .describe("Enable compression (gzip/brotli). Defaults to true."),
  ssg: z
    .boolean()
    .optional()
    .default(true)
    .describe("Enable static site generation. Defaults to true."),
  dryRun: z
    .boolean()
    .optional()
    .default(false)
    .describe("Preview the build without writing files to disk. Defaults to false."),
});

type BuildInput = z.infer<typeof buildInput>;

interface BuildResult {
  success: boolean;
  pages?: number;
  chunks?: number;
  assets?: number;
  totalSize?: number;
  duration_ms?: number;
  outputDir?: string;
  dryRun?: boolean;
  ssgPaths?: string[];
  error?: string;
}

export const vfBuild: MCPTool<BuildInput, BuildResult> = {
  name: "vf_build",
  title: "Production Build",
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  description: "Use this when you need to run a production build for the current project. " +
    "Bundles, optimises, and writes output to the dist directory. " +
    "Use dryRun=true to preview the build without writing files. " +
    "Do not use for development — use the dev server tools instead. " +
    "Do not use for lint checks — use vf_run_lint instead.",
  inputSchema: buildInput,
  execute: (input) =>
    withSpan(
      "cli.mcp.tool.vf_build",
      async () => {
        const projectDir = cwd();
        const outputDir = input.outputDir ?? join(projectDir, "dist");
        const startTime = Date.now();

        try {
          const stats = await buildProduction({
            projectDir,
            outputDir,
            enableSplitting: input.splitting,
            enableCompression: input.compress,
            ssg: input.ssg,
            dryRun: input.dryRun,
          });

          const duration_ms = Date.now() - startTime;

          return {
            success: true,
            pages: stats.pages,
            chunks: stats.chunks,
            assets: stats.assets,
            totalSize: stats.totalSize,
            duration_ms,
            outputDir,
            dryRun: input.dryRun,
            ssgPaths: stats.ssgPaths,
          };
        } catch (error) {
          const duration_ms = Date.now() - startTime;
          return {
            success: false,
            error: error instanceof Error ? error.message : String(error),
            duration_ms,
          };
        }
      },
      { "tool.dryRun": input.dryRun },
    ),
};
