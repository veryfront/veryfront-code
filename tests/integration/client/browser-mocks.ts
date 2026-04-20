import type {
  GlobalWithBrowserAPIs,
  MockHistory,
  MockLocation,
  MockNetworkInformation,
} from "./test-helpers.ts";

export function createMockNavigator(
  connection?: Partial<MockNetworkInformation>,
): Navigator {
  const mockConnection: MockNetworkInformation = {
    effectiveType: connection?.effectiveType ?? "4g",
    saveData: connection?.saveData ?? false,
    downlink: connection?.downlink,
    rtt: connection?.rtt,
  };

  return {
    ...globalThis.navigator,
    connection: mockConnection,
  } as unknown as Navigator;
}

export function createMockHistory(options?: {
  onPushState?: (state: unknown, title: string, url?: string | URL | null) => void;
  onReplaceState?: (state: unknown, title: string, url?: string | URL | null) => void;
}): MockHistory {
  let currentState: unknown = null;
  const states: Array<{ state: unknown; url?: string | URL | null }> = [];
  let currentIndex = 0;

  function updateLocation(url?: string | URL | null): void {
    if (!url) return;

    const urlStr = typeof url === "string" ? url : url.toString();
    const global = globalThis as GlobalWithBrowserAPIs;
    (global.location as unknown as MockLocation).pathname = urlStr;
    (global.location as unknown as MockLocation).href = `${global.location.origin}${urlStr}`;
  }

  return {
    state: currentState,
    length: 1,
    scrollRestoration: "auto" as ScrollRestoration,

    pushState(state: unknown, title: string, url?: string | URL | null): void {
      currentState = state;
      states.push({ state, url });
      currentIndex = states.length - 1;
      options?.onPushState?.(state, title, url);
      updateLocation(url);
    },

    replaceState(state: unknown, title: string, url?: string | URL | null): void {
      currentState = state;
      if (states[currentIndex]) states[currentIndex] = { state, url };
      options?.onReplaceState?.(state, title, url);
      updateLocation(url);
    },

    go(delta?: number): void {
      if (!delta) return;

      const newIndex = currentIndex + delta;
      if (newIndex < 0 || newIndex >= states.length) return;

      currentIndex = newIndex;
      currentState = states[currentIndex].state;
    },

    back(): void {
      this.go(-1);
    },

    forward(): void {
      this.go(1);
    },
  };
}

export function createMockLocation(url = "http://localhost:3000/"): MockLocation {
  const urlObj = new URL(url);

  return {
    href: urlObj.href,
    origin: urlObj.origin,
    protocol: urlObj.protocol,
    host: urlObj.host,
    hostname: urlObj.hostname,
    port: urlObj.port,
    pathname: urlObj.pathname,
    search: urlObj.search,
    hash: urlObj.hash,
    reload(): void {
      // No-op in tests
    },
    replace(nextUrl: string): void {
      const newUrl = new URL(nextUrl, this.origin);
      this.href = newUrl.href;
      this.pathname = newUrl.pathname;
      this.search = newUrl.search;
      this.hash = newUrl.hash;
    },
    assign(nextUrl: string): void {
      this.replace(nextUrl);
    },
  };
}

export function setupRequestIdleCallback(): void {
  const global = globalThis as GlobalWithBrowserAPIs;

  if (!global.requestIdleCallback) {
    global.requestIdleCallback = (callback: IdleRequestCallback) => {
      const start = Date.now();
      return setTimeout(() => {
        callback({
          didTimeout: false,
          timeRemaining: () => Math.max(0, 50 - (Date.now() - start)),
        });
      }, 1);
    };
  }

  if (!global.cancelIdleCallback) {
    global.cancelIdleCallback = (id: number) => {
      clearTimeout(id);
    };
  }
}
