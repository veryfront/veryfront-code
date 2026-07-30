export interface ReactVersionInfo {
  readonly version: string;
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
  readonly isReact17: boolean;
  readonly isReact18: boolean;
  readonly isReact19: boolean;
  readonly features: ReactFeatures;
}

export interface ReactFeatures {
  readonly suspense: boolean;
  readonly streaming: boolean;
  readonly automaticBatching: boolean;
  readonly transitions: boolean;
  readonly serverComponents: boolean;
  readonly useFormStatus: boolean;
  readonly useOptimistic: boolean;
  readonly serverActions: boolean;
  readonly improvedSuspense: boolean;
  readonly enhancedStreaming: boolean;
  readonly renderToString: boolean;
  readonly renderToStaticMarkup: boolean;
  readonly renderToNodeStream: boolean;
  readonly renderToPipeableStream: boolean;
  readonly renderToReadableStream: boolean;
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
