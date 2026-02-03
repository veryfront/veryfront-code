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

    async function fetchPayload(url) {
      try {
        const res = await fetch(url);
        if (!res.ok) return null;
        return await res.json();
      } catch {
        return null;
      }
    }

    function isDevMode() {
      return window.__VERYFRONT_DEV__ === true;
    }

    function validateTrustedHtml(html) {
      const patterns = [
        { pattern: /<script[^>]*>[\\s\\S]*?<\\/script>/gi, name: 'inline script' },
        { pattern: /javascript:/gi, name: 'javascript: URL' },
        { pattern: /\\bon\\w+\\s*=/gi, name: 'event handler attribute' },
        { pattern: /data:\\s*text\\/html/gi, name: 'data: HTML URL' },
      ];

      for (const { pattern, name } of patterns) {
        pattern.lastIndex = 0;
        if (!pattern.test(html)) continue;
        console.warn(\`[Security] Suspicious \${name} detected in server HTML\`);
        if (!isDevMode()) throw new Error(\`Potentially unsafe HTML: \${name} detected\`);
      }

      return html;
    }

    (async () => {
      const renderUrl = '${renderUrl}';
      const payload =
        (await fetchPayload(renderUrl)) ??
        (await fetchPayload('/_veryfront/rsc/payload')) ??
        { html: '<p>RSC unavailable</p>', clientRefs: [] };

      const safeHtml = validateTrustedHtml(String(payload.html || ''));
      document.getElementById('rsc-root').innerHTML = safeHtml;
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
