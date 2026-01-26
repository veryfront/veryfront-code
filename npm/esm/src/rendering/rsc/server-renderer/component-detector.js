export function isClientComponent(Component, clientManifest) {
    if (!Component)
        return false;
    if (Component.__rsc_client === true ||
        Component.$$typeof === Symbol.for("react.client.reference")) {
        return true;
    }
    return clientManifest.has(getComponentId(Component));
}
export function getComponentId(Component) {
    return Component.__rsc_id ?? Component.displayName ?? Component.name ?? "Unknown";
}
export function registerClientRef(id, Component, clientManifest, clientRefs) {
    if (clientRefs.has(id))
        return;
    const meta = clientManifest.get(id);
    const path = meta?.path ?? Component.__rsc_path ?? `/_veryfront/client/${id}.js`;
    clientRefs.set(id, path);
}
