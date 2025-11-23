export interface DevServerOptions {
  port: number;
  projectDir: string;
  hmrPort?: number;
  moduleServerPort?: number;
  enableHMR?: boolean;
  enableFastRefresh?: boolean;
  fileWatcherDebounceMs?: number;
  signal?: AbortSignal;
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
