import { dirname, join } from "../../../platform/compat/path/index.js";
import { createFileSystem } from "../../../platform/compat/fs.js";
const fs = createFileSystem();
export async function writeCompiledFile(filePath, code, options) {
    const relativePath = filePath.replace(options.projectDir, "").replace(/^\//, "");
    const outputPath = join(options.outputDir, relativePath.replace(".mdx", ".js"));
    await fs.mkdir(dirname(outputPath), { recursive: true });
    await fs.writeTextFile(outputPath, code);
    return outputPath;
}
