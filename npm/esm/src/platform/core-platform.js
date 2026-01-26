import * as dntShim from "../../_dnt.shims.js";
export function detectPlatform() {
    // @ts-ignore - Deno global may not exist
    if (typeof dntShim.Deno !== "undefined" && dntShim.Deno.version?.deno)
        return "deno";
    // @ts-ignore - Bun global may not exist
    if (typeof Bun !== "undefined" && Bun.version)
        return "bun";
    // @ts-ignore - caches global specific to CF Workers
    if (typeof caches !== "undefined" &&
        typeof navigator !== "undefined" &&
        navigator.userAgent === "Cloudflare-Workers") {
        return "cloudflare-workers";
    }
    const globalProcess = dntShim.dntGlobalThis.process;
    if (globalProcess?.versions?.node)
        return "node";
    return "unknown";
}
const PLATFORM_CAPABILITIES = {
    deno: {
        canRunMCPServer: true,
        maxAgentSteps: Infinity,
        cpuTimeLimit: null,
        memoryLimit: null,
        hasFileSystem: true,
        supportsLongRunning: true,
        streamingRecommended: false,
        displayName: "Deno",
    },
    node: {
        canRunMCPServer: true,
        maxAgentSteps: Infinity,
        cpuTimeLimit: null,
        memoryLimit: null,
        hasFileSystem: true,
        supportsLongRunning: true,
        streamingRecommended: false,
        displayName: "Node.js",
    },
    bun: {
        canRunMCPServer: true,
        maxAgentSteps: Infinity,
        cpuTimeLimit: null,
        memoryLimit: null,
        hasFileSystem: true,
        supportsLongRunning: true,
        streamingRecommended: false,
        displayName: "Bun",
    },
    "cloudflare-workers": {
        canRunMCPServer: false,
        maxAgentSteps: 3,
        cpuTimeLimit: 30000,
        memoryLimit: 128,
        hasFileSystem: false,
        supportsLongRunning: false,
        streamingRecommended: true,
        displayName: "Cloudflare Workers",
    },
    unknown: {
        canRunMCPServer: false,
        maxAgentSteps: 5,
        cpuTimeLimit: 60000,
        memoryLimit: 512,
        hasFileSystem: false,
        supportsLongRunning: false,
        streamingRecommended: true,
        displayName: "Unknown Platform",
    },
};
export function getPlatformCapabilities(platform) {
    return PLATFORM_CAPABILITIES[platform ?? detectPlatform()] ?? PLATFORM_CAPABILITIES.unknown;
}
export function supportsCapability(capability) {
    const value = getPlatformCapabilities()[capability];
    if (typeof value === "boolean")
        return value;
    if (typeof value === "number")
        return value > 0;
    return false;
}
export function getPlatformWarnings() {
    const capabilities = getPlatformCapabilities();
    const warnings = [];
    if (!capabilities.canRunMCPServer) {
        warnings.push(`MCP server cannot run on ${capabilities.displayName}. Deploy MCP server to a different platform.`);
    }
    if (capabilities.maxAgentSteps < 10) {
        warnings.push(`${capabilities.displayName} has limited agent steps (${capabilities.maxAgentSteps}). Use simple agents only.`);
    }
    if (capabilities.cpuTimeLimit !== null && capabilities.cpuTimeLimit < 60000) {
        warnings.push(`${capabilities.displayName} has CPU time limit of ${capabilities.cpuTimeLimit}ms. Enable streaming for better UX.`);
    }
    if (!capabilities.hasFileSystem) {
        warnings.push(`${capabilities.displayName} has no file system access. Avoid file-based tools.`);
    }
    return warnings;
}
export function validatePlatformCompatibility(config, platform) {
    const capabilities = getPlatformCapabilities(platform);
    const errors = [];
    const warnings = [];
    if (config.maxSteps &&
        capabilities.maxAgentSteps !== Infinity &&
        config.maxSteps > capabilities.maxAgentSteps) {
        errors.push(`Agent maxSteps (${config.maxSteps}) exceeds platform limit (${capabilities.maxAgentSteps})`);
    }
    if (config.requiresFileSystem && !capabilities.hasFileSystem) {
        errors.push(`Agent requires file system but ${capabilities.displayName} doesn't support it`);
    }
    if (config.requiresMCP && !capabilities.canRunMCPServer) {
        errors.push(`Agent requires MCP server but ${capabilities.displayName} cannot run it`);
    }
    if (!config.streaming && capabilities.streamingRecommended) {
        warnings.push(`Streaming is recommended on ${capabilities.displayName} for better user experience`);
    }
    return { compatible: errors.length === 0, errors, warnings };
}
