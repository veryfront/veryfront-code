/** Public facade for the raw-input-only upstream distribution. File/config inputs are unsupported. */
export interface InMemoryPurgeOptions {
  css: Array<{ raw: string }>;
  content: Array<{ raw: string; extension: string }>;
  safelist?: string[];
  rejectedCss?: boolean;
  variables?: boolean;
  keyframes?: boolean;
  fontFace?: boolean;
}
export interface InMemoryPurgeResult {
  css: string;
  file?: undefined;
  rejectedCss?: string;
}
export class PurgeCSS {
  purge(options: InMemoryPurgeOptions): Promise<InMemoryPurgeResult[]>;
}
