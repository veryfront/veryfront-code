import { escapeHTML } from "./html-escape.js";
import { REACT_DEFAULT_VERSION, VERYFRONT_VERSION } from "../utils/constants/cdn.js";
function joinAttributes(attrs) {
    return attrs.filter(Boolean).join(" ");
}
export function buildRootAttributes(slug, mode, noLayout) {
    return joinAttributes([
        'id="root"',
        !noLayout && 'class="vf-tailwind"',
        `data-veryfront-slug="${escapeHTML(slug || "")}"`,
        `data-veryfront-mode="${escapeHTML(mode || "production")}"`,
    ]);
}
export function buildContentAttributes(slug, noLayout, ssrHash) {
    return joinAttributes([
        'id="veryfront-content"',
        `data-slug="${slug || ""}"`,
        `data-layout="${noLayout ? "none" : "default"}"`,
        ssrHash && `data-ssr-hash="${escapeHTML(ssrHash)}"`,
    ]);
}
const DEFAULT_VERSIONS = {
    react: REACT_DEFAULT_VERSION,
    veryfront: VERYFRONT_VERSION,
};
export async function detectVersions(projectDir) {
    try {
        const { createFileSystem } = await import("../platform/compat/fs.js");
        const fs = createFileSystem();
        const content = await fs.readTextFile(`${projectDir}/package.json`);
        const pkg = JSON.parse(content);
        const deps = { ...pkg.dependencies, ...pkg.devDependencies };
        return {
            react: deps.react?.replace(/[\^~]/, "") ?? DEFAULT_VERSIONS.react,
            veryfront: deps.veryfront?.replace(/[\^~]/, "") ?? DEFAULT_VERSIONS.veryfront,
        };
    }
    catch {
        return DEFAULT_VERSIONS;
    }
}
// Platform utilities served from local module server to match SSR behavior.
// This ensures hydration matches (same code on server and client).
// CRITICAL: veryfront/context must use local module to share React context with SSR.
// Using esm.sh creates a separate context instance causing usePageContext to return undefined.
const PLATFORM_UTILITY_PATHS = {
    head: "/_vf_modules/react/components/Head.js",
    router: "/_vf_modules/react/router/index.js",
    context: "/_vf_modules/react/context/index.js",
    fonts: "/_vf_modules/react/fonts/index.js",
};
const PLATFORM_UTILITIES = {
    "veryfront/head": PLATFORM_UTILITY_PATHS.head,
    "veryfront/router": PLATFORM_UTILITY_PATHS.router,
    "veryfront/context": PLATFORM_UTILITY_PATHS.context,
    "veryfront/fonts": PLATFORM_UTILITY_PATHS.fonts,
    "veryfront/react/head": PLATFORM_UTILITY_PATHS.head,
    "veryfront/react/router": PLATFORM_UTILITY_PATHS.router,
    "veryfront/react/context": PLATFORM_UTILITY_PATHS.context,
    "veryfront/react/fonts": PLATFORM_UTILITY_PATHS.fonts,
};
const CDN_URL_TEMPLATES = {
    "esm.sh": {
        react: (v) => `https://esm.sh/react@${v}?target=es2022`,
        reactDom: (v) => `https://esm.sh/react-dom@${v}?target=es2022`,
        reactDomClient: (v) => `https://esm.sh/react-dom@${v}/client?target=es2022`,
        jsxRuntime: (v) => `https://esm.sh/react@${v}/jsx-runtime?target=es2022`,
        jsxDevRuntime: (v) => `https://esm.sh/react@${v}/jsx-dev-runtime?target=es2022`,
        veryfrontAgentReact: (v) => `https://esm.sh/veryfront@${v}/agent/react?external=react,react-dom&target=es2022`,
        veryfrontComponentsAi: (v) => `https://esm.sh/veryfront@${v}/components/ai?external=react,react-dom&target=es2022`,
        veryfrontPrimitives: (v) => `https://esm.sh/veryfront@${v}/primitives?external=react,react-dom&target=es2022`,
    },
    unpkg: {
        react: (v) => `https://unpkg.com/react@${v}/umd/react.production.min.js`,
        reactDom: (v) => `https://unpkg.com/react-dom@${v}/umd/react-dom.production.min.js`,
        reactDomClient: (v) => `https://unpkg.com/react-dom@${v}/umd/react-dom.production.min.js`,
        jsxRuntime: (v) => `https://unpkg.com/react@${v}/jsx-runtime`,
        jsxDevRuntime: (v) => `https://unpkg.com/react@${v}/jsx-dev-runtime`,
        veryfrontAgentReact: (v) => `https://unpkg.com/veryfront@${v}/dist/agent/react.js`,
        veryfrontComponentsAi: (v) => `https://unpkg.com/veryfront@${v}/dist/components/ai.js`,
        veryfrontPrimitives: (v) => `https://unpkg.com/veryfront@${v}/dist/primitives.js`,
    },
    jsdelivr: {
        react: (v) => `https://cdn.jsdelivr.net/npm/react@${v}/umd/react.production.min.js`,
        reactDom: (v) => `https://cdn.jsdelivr.net/npm/react-dom@${v}/umd/react-dom.production.min.js`,
        reactDomClient: (v) => `https://cdn.jsdelivr.net/npm/react-dom@${v}/umd/react-dom.production.min.js`,
        jsxRuntime: (v) => `https://cdn.jsdelivr.net/npm/react@${v}/jsx-runtime`,
        jsxDevRuntime: (v) => `https://cdn.jsdelivr.net/npm/react@${v}/jsx-dev-runtime`,
        veryfrontAgentReact: (v) => `https://cdn.jsdelivr.net/npm/veryfront@${v}/dist/agent/react.js`,
        veryfrontComponentsAi: (v) => `https://cdn.jsdelivr.net/npm/veryfront@${v}/dist/components/ai.js`,
        veryfrontPrimitives: (v) => `https://cdn.jsdelivr.net/npm/veryfront@${v}/dist/primitives.js`,
    },
};
function buildCdnImportMapFromTemplates(versions, templates, includePlatformUtilities) {
    const { react, veryfront } = versions;
    return {
        react: templates.react(react),
        "react-dom": templates.reactDom(react),
        "react-dom/client": templates.reactDomClient(react),
        "react/jsx-runtime": templates.jsxRuntime(react),
        "react/jsx-dev-runtime": templates.jsxDevRuntime(react),
        "veryfront/agent/react": templates.veryfrontAgentReact(veryfront),
        "veryfront/components/ai": templates.veryfrontComponentsAi(veryfront),
        "veryfront/primitives": templates.veryfrontPrimitives(veryfront),
        ...(includePlatformUtilities ? PLATFORM_UTILITIES : {}),
    };
}
function getEsmShImportMap(versions) {
    return buildCdnImportMapFromTemplates(versions, CDN_URL_TEMPLATES["esm.sh"], true);
}
function getUnpkgImportMap(versions) {
    return buildCdnImportMapFromTemplates(versions, CDN_URL_TEMPLATES.unpkg, false);
}
function getJsdelivrImportMap(versions) {
    return buildCdnImportMapFromTemplates(versions, CDN_URL_TEMPLATES.jsdelivr, false);
}
function getSelfHostedImportMap(versions) {
    const { react } = versions;
    const esmShTemplates = CDN_URL_TEMPLATES["esm.sh"];
    return {
        react: esmShTemplates.react(react),
        "react-dom": esmShTemplates.reactDom(react),
        "react-dom/client": esmShTemplates.reactDomClient(react),
        "react/jsx-runtime": esmShTemplates.jsxRuntime(react),
        "react/jsx-dev-runtime": esmShTemplates.jsxDevRuntime(react),
        "veryfront/agent/react": "/_veryfront/lib/agent/react.js",
        "veryfront/components/ai": "/_veryfront/lib/components/ai.js",
        "veryfront/primitives": "/_veryfront/lib/primitives.js",
        "veryfront/head": PLATFORM_UTILITY_PATHS.head,
        "veryfront/router": PLATFORM_UTILITY_PATHS.router,
        "veryfront/context": PLATFORM_UTILITY_PATHS.context,
        "veryfront/fonts": PLATFORM_UTILITY_PATHS.fonts,
    };
}
const CDN_IMPORT_MAP_FACTORIES = {
    unpkg: getUnpkgImportMap,
    jsdelivr: getJsdelivrImportMap,
    "esm.sh": getEsmShImportMap,
};
function getCdnImportMap(versions, provider = "esm.sh") {
    return (CDN_IMPORT_MAP_FACTORIES[provider] ?? getEsmShImportMap)(versions);
}
function getDefaultHTMLImportMap() {
    return getEsmShImportMap(DEFAULT_VERSIONS);
}
async function resolveVersions(projectDir, config) {
    const versionsConfig = config?.client?.cdn?.versions;
    if (!versionsConfig || versionsConfig === "auto") {
        return detectVersions(projectDir);
    }
    const detected = await detectVersions(projectDir);
    return {
        react: versionsConfig.react || detected.react,
        veryfront: versionsConfig.veryfront || detected.veryfront,
    };
}
export async function buildImportMapJson(options) {
    if (options && !("projectDir" in options) && !("config" in options) && !("customImports" in options)) {
        const imports = options;
        if (Object.keys(imports).length > 0) {
            return JSON.stringify({ imports }, null, 2);
        }
    }
    const { projectDir, config, customImports } = (options ?? {});
    const mode = config?.client?.moduleResolution ?? "cdn";
    const versions = projectDir ? await resolveVersions(projectDir, config) : DEFAULT_VERSIONS;
    if (mode === "bundled") {
        const reactTemplates = CDN_URL_TEMPLATES["esm.sh"];
        const imports = {
            react: reactTemplates.react(versions.react),
            "react-dom": reactTemplates.reactDom(versions.react),
            "react-dom/client": reactTemplates.reactDomClient(versions.react),
            "react/jsx-runtime": reactTemplates.jsxRuntime(versions.react),
            "react/jsx-dev-runtime": reactTemplates.jsxDevRuntime(versions.react),
            ...customImports,
        };
        return JSON.stringify({ imports }, null, 2);
    }
    let imports = mode === "self-hosted"
        ? getSelfHostedImportMap(versions)
        : getCdnImportMap(versions, config?.client?.cdn?.provider ?? "esm.sh");
    imports["@/"] = "/_vf_modules/";
    if (customImports) {
        imports = { ...imports, ...customImports };
    }
    return JSON.stringify({ imports }, null, 2);
}
export function buildImportMapJsonSync(importMap) {
    const imports = importMap ?? getDefaultHTMLImportMap();
    return JSON.stringify({ imports }, null, 2);
}
export function shouldDisableLayout(frontmatter) {
    return frontmatter?.layout === false || frontmatter?.layout === "false";
}
