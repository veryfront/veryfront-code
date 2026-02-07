import { z } from "zod";

export const ServerModeSchema = z.enum(["combined", "proxy", "production"]);
export type ServerMode = z.infer<typeof ServerModeSchema>;

export interface ParsedArgs {
  _: (string | number)[];
  port?: number;
  p?: number;
  __explicit?: Record<string, true>;
  help?: boolean;
  h?: boolean;
  version?: boolean;
  v?: boolean;
  quiet?: boolean;
  q?: boolean;
  verbose?: boolean;
  color?: boolean;
  "no-color"?: boolean;
  force?: boolean;
  f?: boolean;
  strict?: boolean;
  s?: boolean;
  template?: string;
  t?: string;
  json?: boolean;
  j?: boolean;
  with?: string[];
  w?: string[];
  /** Server mode: combined (default), proxy, or production */
  mode?: ServerMode;
  m?: ServerMode;
  [key: string]: unknown;
}
