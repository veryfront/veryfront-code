export interface RouteParams {
  [key: string]: string | string[];
}

export interface PathCandidates {
  appRouter: string[];

  pagesRouter: string[];
}
