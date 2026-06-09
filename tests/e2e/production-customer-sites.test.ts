import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";

const PRODUCTION_CUSTOMER_SITES = [
  {
    name: "codersociety.com",
    project: "codersociety",
    url: "https://codersociety.com",
    expectedText: "A network of 300 senior experts to boost your tech projects",
  },
  {
    name: "tomcode.com",
    project: "tomcode",
    url: "https://tomcode.com",
    expectedText: "TOMcode Cloud-Native DevOps Platform",
  },
] as const;

for (const site of PRODUCTION_CUSTOMER_SITES) {
  Deno.test(`production customer project ${site.project} serves ${site.name}`, async () => {
    const response = await fetch(site.url);
    const html = await response.text();

    assertEquals(response.status, 200);
    assertStringIncludes(response.headers.get("content-type") ?? "", "text/html");
    assertStringIncludes(html, site.expectedText);
    assertEquals(html.includes("Internal Server Error"), false);
  });
}
