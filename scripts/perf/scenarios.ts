export const scenarios = [
  "request-timing",
  "ssr",
  "http-api",
  "http-cached",
  "http-ssr",
  "http-dev",
] as const;
export type Scenario = typeof scenarios[number];
