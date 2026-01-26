export interface ReactVersionInfo {
  version: string;
  major: number;
  minor: number;
  patch: number;
  isReact17: boolean;
  isReact18: boolean;
  isReact19: boolean;
  features: ReactFeatures;
}

export interface ReactFeatures {
  suspense: boolean;
  streaming: boolean;
  automaticBatching: boolean;
  transitions: boolean;
  serverComponents: boolean;
  useFormStatus: boolean;
  useOptimistic: boolean;
  serverActions: boolean;
  improvedSuspense: boolean;
  enhancedStreaming: boolean;
  renderToString: boolean;
  renderToStaticMarkup: boolean;
  renderToNodeStream: boolean;
  renderToPipeableStream: boolean;
  renderToReadableStream: boolean;
}

export interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
}

export interface CompatibilityCheckResult {
  compatible: boolean;
  warnings: string[];
  errors: string[];
}

export type SSRMethod = "string" | "stream" | "readable-stream";
