import { chromium, request as playwrightRequest } from "playwright";

const PROJECTS = ["alpha", "beta"];
const PORT = 8080;
const DEBUG_CONTEXT_PATH = "/_vf_debug/context";
const RUNTIMES = [
  {
    environment: "production",
    hostname: (project) => `${project}.localhost`,
  },
  {
    environment: "preview",
    hostname: (project) => `${project}.preview.localhost`,
  },
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function verifyContext(payload, project, environment) {
  assert(payload?.context?.projectSlug === project, `Expected project ${project}`);
  assert(
    payload?.context?.parsedDomain?.environment === environment,
    `Expected environment ${environment}`,
  );
}

const browser = await chromium.launch({ headless: true });
const api = await playwrightRequest.newContext();
try {
  const page = await browser.newPage();
  for (const runtime of RUNTIMES) {
    for (const project of PROJECTS) {
      const hostname = runtime.hostname(project);
      const browserResponse = await page.goto(`http://${hostname}:${PORT}${DEBUG_CONTEXT_PATH}`);
      assert(browserResponse?.ok(), `Browser request failed for ${hostname}`);
      verifyContext(await browserResponse.json(), project, runtime.environment);

      const nativeResponse = await api.get(`http://127.0.0.1:${PORT}${DEBUG_CONTEXT_PATH}`, {
        headers: { host: `${hostname}:${PORT}` },
      });
      assert(nativeResponse.ok(), `Native request failed for ${hostname}`);
      verifyContext(await nativeResponse.json(), project, runtime.environment);
    }
  }
  console.log(JSON.stringify({ success: true, browserRequests: 4, nativeRequests: 4 }));
} finally {
  await api.dispose();
  await browser.close();
}
