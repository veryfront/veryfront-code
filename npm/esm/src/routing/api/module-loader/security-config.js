import { DEFAULT_ALLOWED_CDN_HOSTS, serverLogger as logger } from "../../../utils/index.js";
export async function loadSecurityConfig(projectDir, adapter) {
    try {
        const { getConfig } = await import("../../../config/index.js");
        const cfg = await getConfig(projectDir, adapter);
        const remote = cfg?.security?.remoteHosts;
        if (Array.isArray(remote))
            return remote;
    }
    catch (e) {
        logger.warn("Failed to load security.remoteHosts", e);
    }
    return DEFAULT_ALLOWED_CDN_HOSTS;
}
