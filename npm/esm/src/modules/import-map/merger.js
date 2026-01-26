export function mergeImportMaps(...maps) {
    const imports = {};
    const scopes = {};
    for (const { imports: mapImports, scopes: mapScopes } of maps) {
        if (mapImports)
            Object.assign(imports, mapImports);
        if (!mapScopes)
            continue;
        for (const [scope, scopeImports] of Object.entries(mapScopes)) {
            scopes[scope] ??= {};
            Object.assign(scopes[scope], scopeImports);
        }
    }
    return { imports, scopes };
}
