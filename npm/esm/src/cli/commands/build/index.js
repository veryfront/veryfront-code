import { join } from "../../../platform/compat/path/index.js";
import { runtime } from "../../../platform/adapters/registry.js";
import { getConfig } from "../../../config/index.js";
import { buildProduction } from "../../../build/production-build/index.js";
import { withSpan } from "../../../observability/tracing/otlp-setup.js";
import { displayBuildConfig, displayBuildStart } from "./config-display.js";
import { handleBuildError } from "./error-handler.js";
import { displayBuildSuccess } from "./stats-display.js";
export function buildCommand(options) {
    return withSpan("cli.command.build", async () => {
        const outputDir = options.outputDir ?? join(options.projectDir, "dist");
        const startTime = Date.now();
        const dryRun = options.dryRun ?? false;
        try {
            displayBuildConfig({ ...options, outputDir });
            const adapter = await runtime.get();
            await getConfig(options.projectDir, adapter);
            displayBuildStart();
            const stats = await buildProduction({
                projectDir: options.projectDir,
                outputDir,
                enableSplitting: options.splitting ?? true,
                enableCompression: options.compress ?? true,
                enablePrefetch: options.prefetch ?? true,
                ssg: options.ssg ?? true,
                include: options.include,
                exclude: options.exclude,
                dryRun,
            });
            displayBuildSuccess(stats, startTime, outputDir, dryRun);
        }
        catch (error) {
            handleBuildError(error);
        }
    }, { "cli.projectDir": options.projectDir });
}
