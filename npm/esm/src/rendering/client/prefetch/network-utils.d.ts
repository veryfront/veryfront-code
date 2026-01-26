export interface NetworkInfo {
    effectiveType?: string;
    saveData?: boolean;
    addEventListener?: (event: string, handler: () => void) => void;
}
export declare class NetworkUtils {
    private networkInfo;
    private allowedNetworks;
    constructor(allowedNetworks?: string[]);
    private getNavigatorWithConnection;
    private getNetworkConnection;
    shouldPrefetch(): boolean;
    onNetworkChange(callback: () => void): void;
    getNetworkInfo(): NetworkInfo | null;
}
//# sourceMappingURL=network-utils.d.ts.map