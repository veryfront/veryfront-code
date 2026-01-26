export function normalizePlugins(plugins) {
    if (!plugins)
        return [];
    return (Array.isArray(plugins) ? plugins.flat() : [plugins]);
}
