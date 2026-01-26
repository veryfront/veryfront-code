import { join } from "../../../platform/compat/path/index.js";
import { logger } from "../../../utils/index.js";
import { runtime } from "../../../platform/adapters/detect.js";
import { createFileSystem } from "../../../platform/compat/fs.js";
import { withSpan } from "../../../observability/tracing/otlp-setup.js";
import { TailwindProcessor } from "./processor.js";
import { isTailwindV4File } from "./detector.js";
export function processTailwindCSS(options) {
    return withSpan("build.asset.processTailwindCSS", () => new TailwindProcessor(options).process(), {
        "tailwind.inputFile": options.inputFile,
        "tailwind.outputFile": options.outputFile ?? "",
    });
}
export function processTailwindCSSInDirectory(projectDir, cssDir = "styles", outputDir = ".veryfront/css") {
    return withSpan("build.asset.processTailwindCSSInDirectory", async () => {
        const results = [];
        const cssPath = join(projectDir, cssDir);
        const fs = createFileSystem();
        const adapter = await runtime.get();
        try {
            for await (const entry of fs.readDir(cssPath)) {
                if (!entry.isFile || !entry.name.endsWith(".css"))
                    continue;
                const filePath = join(cssPath, entry.name);
                const isTailwind = await isTailwindV4File(filePath, projectDir, adapter);
                if (!isTailwind)
                    continue;
                logger.info("Found Tailwind v4 file", { file: filePath });
                results.push(await processTailwindCSS({
                    projectDir,
                    adapter,
                    inputFile: filePath,
                    outputFile: join(projectDir, outputDir, entry.name),
                }));
            }
        }
        catch (error) {
            logger.error("Error processing Tailwind CSS directory", error);
        }
        return results;
    }, {
        "tailwind.projectDir": projectDir,
        "tailwind.cssDir": cssDir,
        "tailwind.outputDir": outputDir,
    });
}
