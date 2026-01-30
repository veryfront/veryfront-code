import { cliLogger as logger, VERSION } from "../../../utils/index.js";
import { join } from "../../../platform/compat/path/index.js";
import { createFileSystem } from "../../../platform/compat/fs.js";
export async function createPackageJson(projectDir, projectName) {
    const packageJson = {
        name: projectName ?? "veryfront-project",
        version: "0.1.0",
        type: "module",
        scripts: {
            dev: "veryfront dev",
            build: "veryfront build",
            preview: "veryfront preview",
        },
        dependencies: {
            react: "^19.0.0",
            "react-dom": "^19.0.0",
            veryfront: `^${VERSION}`,
            zod: "^3.24.0",
        },
    };
    const fs = createFileSystem();
    await fs.writeTextFile(join(projectDir, "package.json"), JSON.stringify(packageJson, null, 2));
    logger.debug('Created package.json with "type": "module"');
}
