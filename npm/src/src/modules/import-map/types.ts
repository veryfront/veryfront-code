export interface ImportMapConfig {
  imports?: Record<string, string>;
  scopes?: Record<string, Record<string, string>>;
}

export interface TransformOptions {
  resolveBare?: boolean;
}
