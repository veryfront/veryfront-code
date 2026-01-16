export interface DevServerOptions {
  port: number;
  projectDir: string;
  hmrPort?: number;
  moduleServerPort?: number;
  enableHMR?: boolean;
  enableFastRefresh?: boolean;
  fileWatcherDebounceMs?: number;
  signal?: AbortSignal;
  /**
   * Optional request interceptor for combined mode.
   * Transforms requests before they're processed by the dev server.
   * Used by proxy middleware to inject context headers.
   */
  requestInterceptor?: (req: Request) => Request | Promise<Request>;
}

export interface RouteDirectory {
  type: "app" | "pages";
  path: string;
}

export interface FileWatcherMetrics {
  totalFileChangeEvents: number;
  routeDiscoveryCalls: number;
  averageBatchSize: string;
  largestBatch: number;
  fsOperationReduction: string;
}
