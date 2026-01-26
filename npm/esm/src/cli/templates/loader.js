/**
 * Template loader using JSON manifest.
 *
 * Templates are compiled to a JSON manifest at build time, which allows
 * them to be embedded in compiled binaries without deno compile trying
 * to analyze them as TypeScript modules.
 */
import manifest from "./manifest.js";
const typedManifest = manifest;
export function loadTemplateFromDirectory(templateName) {
    const entry = typedManifest.templates[templateName];
    if (!entry)
        return Promise.resolve([]);
    const files = Object.entries(entry.files)
        .map(([path, content]) => ({ path, content }))
        .sort((a, b) => a.path.localeCompare(b.path));
    return Promise.resolve(files);
}
export function getTemplateDirectory(templateName) {
    // For compatibility - returns a virtual path since templates are in manifest
    return `manifest://${templateName}`;
}
export function templateDirectoryExists(templateName) {
    return Promise.resolve(templateName in typedManifest.templates);
}
export function getIntegrationTemplate(integrationName) {
    const entry = typedManifest.templates[`integration:${integrationName}`];
    if (!entry)
        return null;
    return Object.entries(entry.files)
        .map(([path, content]) => ({ path, content }))
        .sort((a, b) => a.path.localeCompare(b.path));
}
export function listTemplates() {
    return Object.keys(typedManifest.templates).filter((name) => !name.startsWith("integration:"));
}
export function listIntegrations() {
    return Object.keys(typedManifest.templates)
        .filter((name) => name.startsWith("integration:"))
        .map((name) => name.replace("integration:", ""));
}
