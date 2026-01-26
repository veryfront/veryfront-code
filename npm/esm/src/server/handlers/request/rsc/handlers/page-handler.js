import * as dntShim from "../../../../../../_dnt.shims.js";
export class PageHandler {
    handle(pathname, searchParams) {
        return new dntShim.Response(this.buildHtml(pathname, searchParams), {
            headers: { "content-type": "text/html; charset=utf-8" },
        });
    }
    buildHtml(pathname, searchParams) {
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

    async function fetchPayload(url) {
      try {
        const res = await fetch(url);
        if (!res.ok) return null;
        return await res.json();
      } catch {
        return null;
      }
    }

    (async () => {
      const renderUrl = '${renderUrl}';
      const payload =
        (await fetchPayload(renderUrl)) ??
        (await fetchPayload('/_veryfront/rsc/payload')) ??
        { html: '<p>RSC unavailable</p>', clientRefs: [] };

      document.getElementById('rsc-root').innerHTML = payload.html;
      window.__RSC_CLIENT_REFS__ = payload.clientRefs;

      if (!window.VeryfrontHydrate?.run) return;
      return window.VeryfrontHydrate.run();
    })().catch(error => {
      console.error('[RSC] Failed to load:', error);
      document.getElementById('rsc-root').innerHTML = '<p>Failed to load RSC component</p>';
    });
  </script>
</body>
</html>`;
    }
}
