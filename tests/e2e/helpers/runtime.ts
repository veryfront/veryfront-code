export const PLAYWRIGHT_RUNTIME_CONFIGS = [
  {
    name: "production-host",
    modeName: "production",
    getUrl: (subdomain: string) => `http://${subdomain}.lvh.me:8080`,
  },
  {
    name: "preview-host",
    modeName: "preview",
    getUrl: (subdomain: string) => `http://${subdomain}.preview.lvh.me:8080`,
  },
] as const;

export type PlaywrightRuntimeConfig = (typeof PLAYWRIGHT_RUNTIME_CONFIGS)[number];
export type PlaywrightRuntimeName = PlaywrightRuntimeConfig["name"];

export function getRuntimeForPlaywrightProject(projectName: string): PlaywrightRuntimeConfig {
  const runtime = PLAYWRIGHT_RUNTIME_CONFIGS.find((candidate) => candidate.name === projectName);
  if (runtime) return runtime;

  throw new Error(`Unknown Playwright project: ${projectName}`);
}
