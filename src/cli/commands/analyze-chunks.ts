import {
  analyzeProjectChunks,
  generateChunkManifest,
} from "@veryfront/rendering/chunk-optimizer.ts";
import { cliLogger } from "@veryfront/utils";

export interface AnalyzeChunksOptions {
  projectDir: string;
  output?: string;
}

export async function analyzeChunksCommand(options: AnalyzeChunksOptions) {
  const { projectDir, output } = options;

  try {
    const analysis = await analyzeProjectChunks(projectDir);

    if (analysis.sharedDeps.size > 0) {
      cliLogger.info("Top shared dependencies:");
      const sorted = Array.from(analysis.sharedDeps.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10);

      for (const [dep, count] of sorted) {
        cliLogger.info(`  ${dep} (${count} pages)`);
      }
      cliLogger.info("");
    }

    if (analysis.suggestedChunks.length > 0) {
      cliLogger.info("Suggested chunks:");
      for (const chunk of analysis.suggestedChunks) {
        if (chunk.deps.length <= 5) continue;
        const pageCount = chunk.pages.length > 0 ? `${chunk.pages.length} pages` : "unknown pages";
        cliLogger.info(
          `  ${chunk.name} (${chunk.deps.length} deps, ${pageCount}, ~${chunk.benefit} bytes saved)`,
        );
      }
      cliLogger.info("");
    }

    if (output) {
      const _manifest = generateChunkManifest(analysis);
      await Deno.writeTextFile(output, JSON.stringify(_manifest, null, 2));
      cliLogger.info(`Saved chunk manifest to ${output}`);
    }

    const totalSharedUsage = Array.from(analysis.sharedDeps.values()).reduce(
      (sum, count) => sum + count,
      0,
    );
    const avgUsage = totalSharedUsage / analysis.sharedDeps.size;

    if (avgUsage > 3) {
      cliLogger.info(
        `Average shared dependency usage (${
          avgUsage.toFixed(2)
        }) suggests splitting common UI modules.`,
      );
    }

    const hasHeavyDeps = Array.from(analysis.sharedDeps.keys()).some(
      (dep) => dep.includes("@mui/") || dep.includes("framer-motion") || dep.includes("three"),
    );

    if (hasHeavyDeps) {
      cliLogger.info(
        "Detected heavy UI libraries shared across pages. Break them into dedicated chunks.",
      );
    }
  } catch (_error) {
    Deno.exit(1);
  }
}
