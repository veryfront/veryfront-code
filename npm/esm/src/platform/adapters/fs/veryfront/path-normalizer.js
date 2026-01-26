import { logger } from "../../../../utils/index.js";
export class PathNormalizer {
    projectDir;
    constructor(projectDir) {
        this.projectDir = projectDir;
    }
    getProjectDir() {
        return this.projectDir;
    }
    normalize(path) {
        const projectDir = this.projectDir;
        const wasAbsoluteInProject = !!projectDir && path.startsWith(projectDir);
        let normalized = path;
        if (wasAbsoluteInProject) {
            normalized = normalized.slice(projectDir.length);
        }
        normalized = normalized.replace(/^\/+|\/+$/g, "").replace(/\/+/g, "/");
        if (normalized.startsWith("@/")) {
            const original = normalized;
            normalized = normalized.slice(2);
            logger.debug("[PathNormalizer] Stripped path alias", { original, normalized });
        }
        if (wasAbsoluteInProject && normalized !== path) {
            logger.debug("[PathNormalizer] Converted absolute to relative path", {
                absolute: path,
                relative: normalized,
                projectDir,
            });
        }
        return normalized;
    }
}
