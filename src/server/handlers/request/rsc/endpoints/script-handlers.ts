/**
 * Script endpoint handlers (client.js, dom.js)
 * @module rsc-endpoints/script-handlers
 */

import type { RuntimeAdapter } from "@veryfront/platform/adapters/base.ts";
import { serverLogger } from "@veryfront/utils";

/**
 * Handle client.js endpoint
 * @returns Response with client boot script
 */
export function handleClientScript(): Response {
  // Mirror prod: inline small boot script that streams + hydrates
  const code = `import { getContainer, consumeNdjsonStream } from '/_veryfront/rsc/dom.js';
async function tryStream(q){
  try{
    const res = await fetch('/_veryfront/rsc/stream'+q);
    if(!res.ok || !res.body) return false;
    const ctrl = new AbortController();
    addEventListener('pagehide', () => ctrl.abort(), { once:true });
    await consumeNdjsonStream(res, document, ctrl.signal);
    return true;
  }catch(e){ console.debug?.('[RSC] tryStream failed', e); return false; }
}
async function hydrate(){ try{ await import('/_veryfront/rsc/hydrate.js').then(m=>m.bootHydration?.()); }catch(e){ console.debug?.('[RSC] hydrate import failed', e); } }
export async function boot(){
  try{
    const q = window.location.search || '';
    const streamed = await tryStream(q);
    if(streamed){ await hydrate(); return; }
    const res = await fetch('/_veryfront/rsc/payload'+q);
    const data = await res.json();
    if(data && data.slots){ for(const [id, html] of Object.entries(data.slots)){ const el = getContainer(document, id); el.innerHTML = String(html||''); } } else { const el = getContainer(document, 'root'); el.innerHTML = String(data.html || ''); }
    await hydrate();
  }catch(e){ console.error('[RSC] boot failed', e); }
}`;

  return new Response(code, {
    headers: { "content-type": "application/javascript" },
  });
}

/**
 * Handle dom.js endpoint - bundles client-dom.ts to ESM
 * @param adapter - Runtime adapter for file operations
 * @returns Response with bundled DOM utilities
 */
export async function handleDomScript(adapter: RuntimeAdapter): Promise<Response> {
  try {
    // Use native esbuild for proper file system access during bundling
    const esbuild = await import("esbuild/mod.js");
    const p = new URL("../../../../../rendering/rsc/client-dom.ts", import.meta.url).pathname;
    const src = await adapter.fs.readFile(p);
    const result = await esbuild.build({
      bundle: true,
      write: false,
      format: "esm",
      platform: "browser",
      target: "es2020",
      stdin: {
        contents: src,
        loader: "ts",
        resolveDir: p.substring(0, p.lastIndexOf("/")),
        sourcefile: p,
      },
    });
    const out = result.outputFiles?.[0]?.text ?? src;

    // Stop esbuild service to prevent process leaks
    if (esbuild.stop) {
      esbuild.stop();
    }

    return new Response(out, {
      headers: { "content-type": "application/javascript" },
    });
  } catch (error) {
    serverLogger.debug("[ScriptHandlers] Build failed, serving raw TypeScript", error);
    const p = new URL("../../../../../rendering/rsc/client-dom.ts", import.meta.url).pathname;
    const src = await adapter.fs.readFile(p);
    return new Response(src, {
      headers: { "content-type": "application/typescript" },
    });
  }
}
