export class NetworkUtils {
    networkInfo;
    allowedNetworks;
    constructor(allowedNetworks = ["4g", "wifi", "ethernet"]) {
        this.allowedNetworks = allowedNetworks;
        this.networkInfo = this.getNetworkConnection();
    }
    getNavigatorWithConnection() {
        if (typeof globalThis.navigator === "undefined")
            return null;
        return globalThis.navigator;
    }
    getNetworkConnection() {
        const nav = this.getNavigatorWithConnection();
        return nav?.connection ?? nav?.mozConnection ?? nav?.webkitConnection ?? null;
    }
    shouldPrefetch() {
        const nav = this.getNavigatorWithConnection();
        if (nav?.connection?.saveData)
            return false;
        const effectiveType = this.networkInfo?.effectiveType;
        if (effectiveType !== undefined && !this.allowedNetworks.includes(effectiveType))
            return false;
        return true;
    }
    onNetworkChange(callback) {
        this.networkInfo?.addEventListener?.("change", callback);
    }
    getNetworkInfo() {
        return this.networkInfo;
    }
}
