const PLAYWRIGHT_RUNTIME_PORT = 8080;
const PLAYWRIGHT_RUNTIME_ORIGIN = `http://127.0.0.1:${PLAYWRIGHT_RUNTIME_PORT}`;

function createApiRequest(hostname: string, path: string) {
  return {
    url: `${PLAYWRIGHT_RUNTIME_ORIGIN}${path}`,
    headers: { host: `${hostname}:${PLAYWRIGHT_RUNTIME_PORT}` },
  };
}

export const PLAYWRIGHT_RUNTIME_CONFIGS = [
  {
    name: "production-host",
    modeName: "production",
    getUrl: (subdomain: string) => `http://${subdomain}.localhost:${PLAYWRIGHT_RUNTIME_PORT}`,
    getApiRequest: (subdomain: string, path: string) =>
      createApiRequest(`${subdomain}.localhost`, path),
  },
  {
    name: "preview-host",
    modeName: "preview",
    getUrl: (subdomain: string) =>
      `http://${subdomain}.preview.localhost:${PLAYWRIGHT_RUNTIME_PORT}`,
    getApiRequest: (subdomain: string, path: string) =>
      createApiRequest(`${subdomain}.preview.localhost`, path),
  },
] as const;

export type PlaywrightRuntimeConfig = (typeof PLAYWRIGHT_RUNTIME_CONFIGS)[number];
export type PlaywrightRuntimeName = PlaywrightRuntimeConfig["name"];

export function getRuntimeForPlaywrightProject(projectName: string): PlaywrightRuntimeConfig {
  const runtime = PLAYWRIGHT_RUNTIME_CONFIGS.find((candidate) => candidate.name === projectName);
  if (runtime) return runtime;

  throw new Error(`Unknown Playwright project: ${projectName}`);
}
