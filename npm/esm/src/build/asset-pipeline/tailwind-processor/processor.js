import { dirname } from "../../../platform/compat/path/index.js";
import { logger } from "../../../utils/index.js";
import { autoDetectContentPaths, isTailwindV4File } from "./detector.js";
import { countUtilities } from "./css-utils.js";
import { processWithLightningCSS } from "./lightning-processor.js";
import { createSecureFs } from "../../../security/index.js";
import { withSpan } from "../../../observability/tracing/otlp-setup.js";
export class TailwindProcessor {
    options;
    constructor(options) {
        this.options = {
            content: autoDetectContentPaths(options.projectDir),
            minify: true,
            sourceMap: false,
            browserslist: ["defaults", "not IE 11"],
            ...options,
        };
    }
    process() {
        return withSpan("build.tailwind.process", async () => {
            const { inputFile, outputFile, content, minify, sourceMap, browserslist, projectDir, adapter, } = this.options;
            const secureFs = createSecureFs({
                baseDir: projectDir,
                adapter,
                context: "build",
                throwOnError: true,
            });
            logger.info("Processing Tailwind CSS v4...", { inputFile, outputFile });
            const inputCSS = await secureFs.readFile(inputFile);
            const isTailwind = await isTailwindV4File(inputFile, projectDir, adapter);
            if (!isTailwind) {
                logger.warn('File does not appear to be Tailwind v4 (@import "tailwindcss" not found)', {
                    inputFile,
                });
            }
            const processedCSS = await processWithLightningCSS(inputCSS, {
                filename: inputFile,
                minify,
                sourceMap,
                browserslist,
            });
            const detectedUtilities = countUtilities(processedCSS);
            const result = {
                css: processedCSS,
                processedFiles: [inputFile, ...(content ?? [])],
                detectedUtilities,
            };
            if (!outputFile)
                return result;
            const dirPath = dirname(outputFile);
            await secureFs.mkdir(dirPath, { recursive: true });
            await secureFs.writeFile(outputFile, processedCSS);
            logger.info("Tailwind CSS processed successfully", {
                inputFile,
                outputFile,
                size: processedCSS.length,
                utilities: detectedUtilities,
            });
            return result;
        }, {
            "build.tailwind.inputFile": this.options.inputFile,
            "build.tailwind.minify": this.options.minify ?? true,
        });
    }
}
