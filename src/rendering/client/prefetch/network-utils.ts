export interface NetworkInfo {
  effectiveType?: string;
  saveData?: boolean;
  addEventListener?: (event: string, handler: () => void) => void;
}

interface NavigatorWithConnection extends Navigator {
  connection?: NetworkInfo;
  mozConnection?: NetworkInfo;
  webkitConnection?: NetworkInfo;
}

export class NetworkUtils {
  private networkInfo: NetworkInfo | null;
  private allowedNetworks: string[];

  constructor(allowedNetworks: string[] = ["4g", "wifi", "ethernet"]) {
    this.allowedNetworks = allowedNetworks;
    this.networkInfo = this.getNetworkConnection();
  }

  private getNavigatorWithConnection(): NavigatorWithConnection | null {
    if (typeof globalThis.navigator === "undefined") return null;
    return globalThis.navigator as NavigatorWithConnection;
  }

  private getNetworkConnection(): NetworkInfo | null {
    const nav = this.getNavigatorWithConnection();
    return nav?.connection ?? nav?.mozConnection ?? nav?.webkitConnection ?? null;
  }

  shouldPrefetch(): boolean {
    if (this.networkInfo?.saveData) return false;

    const effectiveType = this.networkInfo?.effectiveType;
    if (effectiveType != null && !this.allowedNetworks.includes(effectiveType)) return false;

    return true;
  }

  onNetworkChange(callback: () => void): void {
    this.networkInfo?.addEventListener?.("change", callback);
  }

  getNetworkInfo(): NetworkInfo | null {
    return this.networkInfo;
  }
}
