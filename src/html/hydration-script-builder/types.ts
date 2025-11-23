export interface HydrationLayout {
  kind: string;
  path: string;
}

export interface HydrationDataStructure {
  slug: string;
  props: Record<string, unknown>;
  params: Record<string, string | string[]>;
  layouts: HydrationLayout[];
  providers: string[];
  appPath?: string;
  pagePath?: string;
}
