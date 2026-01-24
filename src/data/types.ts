export interface DataContext {
  params: Record<string, string | string[]>;
  query: URLSearchParams;
  request: Request;
  url: URL;
}

export interface DataResult<T = unknown> {
  props?: T;
  redirect?: {
    destination: string;
    permanent?: boolean;
  };
  notFound?: boolean;
  revalidate?: number | false;
}

export interface PageWithData<T = unknown> {
  default: unknown;
  getServerData?: (context: DataContext) => DataResult<T> | Promise<DataResult<T>>;
  getStaticData?: (
    context: Omit<DataContext, "request" | "query">,
  ) => DataResult<T> | Promise<DataResult<T>>;
  getStaticPaths?: () => StaticPathsResult | Promise<StaticPathsResult>;
}

export interface StaticPathsResult {
  paths: Array<{
    params: Record<string, string | string[]>;
  }>;
  fallback: boolean | "blocking";
}

export interface CacheEntry<T = unknown> {
  data: DataResult<T>;
  timestamp: number;
  revalidate?: number | false;
}

export type InferGetServerDataProps<T> = T extends PageWithData<infer P> ? P : never;
