import { serverLogger as logger } from "@veryfront/utils";

export class PageHandler {
  handle(pathname: string, searchParams: URLSearchParams): Response {
    const html = this.buildHtml(pathname, searchParams);

    return new Response(html, {
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }

  private buildHtml(pathname: string, searchParams: URLSearchParams): string {
    const queryString = searchParams.toString();
    const renderUrl = `/_veryfront/rsc/render${pathname}${queryString ? `?${queryString}` : ""}`;

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Veryfront RSC</title>
  <script>window.__VERYFRONT_DEV__ = true;</script>
</head>
<body>
  <div id="rsc-root"></div>
  <script type="module">
    await import('/_veryfront/rsc/hydrate.js').catch(() => void 0);

    (async () => {
      const renderUrl = '${renderUrl}';
      let payload;
      try {
        const res = await fetch(renderUrl);
        if (res.ok) {
          payload = await res.json();
        } else {
          const demo = await fetch('/_veryfront/rsc/payload').catch(() => null);
          payload = demo && demo.ok ? await demo.json() : { html: '<p>RSC unavailable</p>', clientRefs: [] };
        }
      } catch {
        const demo = await fetch('/_veryfront/rsc/payload').catch(() => null);
        payload = demo && demo.ok ? await demo.json() : { html: '<p>RSC unavailable</p>', clientRefs: [] };
      }
        document.getElementById('rsc-root').innerHTML = payload.html;

        window.__RSC_CLIENT_REFS__ = payload.clientRefs;

        if (window.VeryfrontHydrate && typeof window.VeryfrontHydrate.run === 'function') {
          return window.VeryfrontHydrate.run();
        }
    })()
      .catch(error => {
        ${logger.toString()}.error('[RSC] Failed to load:', error);
        document.getElementById('rsc-root').innerHTML = '<p>Failed to load RSC component</p>';
      });
  </script>
</body>
</html>`;
  }
}
