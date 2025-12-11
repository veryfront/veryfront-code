
export interface ValidationOptions {
  maxDepth?: number;

  debugMode?: boolean;
}

export interface InvalidObjectDetails {
  path: string;

  depth: number;

  keys: string[];

  hasSymbol: boolean;

  symbolValue: unknown;

  type: unknown;

  constructor: string | undefined;

  sample: string;
}
