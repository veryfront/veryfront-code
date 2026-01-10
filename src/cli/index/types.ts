export interface BuildCommandArgs {
  _: (string | number)[];
  output?: string;
  o?: string;
  preset?: string;
  split?: boolean;
  compress?: boolean;
  prefetch?: boolean;
  ssg?: boolean;
  "no-ssg"?: boolean;
  include?: string | string[];
  exclude?: string | string[];
  "dry-run"?: boolean;
  dryrun?: boolean;
}

export interface GenerateCommandArgs {
  _: (string | number)[];
}

export interface ParsedArgs {
  _: (string | number)[];
  port?: number;
  p?: number;
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
  [key: string]: unknown;
}
