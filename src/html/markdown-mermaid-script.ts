/**
 * Build the browser enhancement used for Mermaid blocks in standalone
 * Markdown previews.
 *
 * Diagram source remains readable until Mermaid succeeds. Rendering and
 * theme changes are serialized because Mermaid configuration is module-wide
 * mutable state.
 *
 * @module html/markdown-mermaid-script
 */

import { MERMAID_ESM_URL } from "#veryfront/utils/constants/cdn.ts";
import { buildNonceAttribute } from "./html-escape.ts";

/** Return a nonce-aware module script that progressively enhances Mermaid source. */
export function buildMarkdownMermaidScript(nonce?: string): string {
  const nonceAttr = buildNonceAttribute(nonce);

  return `<script type="module"${nonceAttr}>
import mermaid from '${MERMAID_ESM_URL}';

const sourceByDiagram = new WeakMap();
const diagrams = new Set();
let renderQueue = Promise.resolve();

function rememberDiagram(diagram, source) {
  sourceByDiagram.set(diagram, source);
  diagrams.add(diagram);
}

function collectMermaidDiagrams() {
  document.querySelectorAll('code.language-mermaid').forEach((code) => {
    const pre = code.parentElement;
    if (pre?.tagName !== 'PRE') return;

    const source = code.textContent ?? '';
    const diagram = document.createElement('pre');
    diagram.className = 'mermaid';
    diagram.textContent = source;
    pre.replaceWith(diagram);
    rememberDiagram(diagram, source);
  });

  document.querySelectorAll('pre.mermaid, div.mermaid').forEach((diagram) => {
    if (!sourceByDiagram.has(diagram)) {
      rememberDiagram(diagram, diagram.textContent ?? '');
    }
  });
}

function restoreMermaidSource(diagram) {
  const source = sourceByDiagram.get(diagram);
  if (source === undefined) return;
  diagram.replaceChildren(document.createTextNode(source));
  diagram.removeAttribute('data-processed');
}

function getMermaidTheme() {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'default';
}

async function renderMermaidDiagrams() {
  collectMermaidDiagrams();

  for (const diagram of diagrams) {
    if (!diagram.isConnected) diagrams.delete(diagram);
  }
  const connectedDiagrams = Array.from(diagrams);
  if (connectedDiagrams.length === 0) return;

  connectedDiagrams.forEach(restoreMermaidSource);
  try {
    mermaid.initialize({
      startOnLoad: false,
      theme: getMermaidTheme(),
      securityLevel: 'strict',
    });
    await mermaid.run({ nodes: connectedDiagrams });
  } catch (error) {
    connectedDiagrams.forEach(restoreMermaidSource);
    console.error(
      '[Veryfront] Mermaid rendering failed; showing source.',
      error,
    );
  }
}

function scheduleMermaidRender() {
  renderQueue = renderQueue.then(renderMermaidDiagrams, renderMermaidDiagrams);
  return renderQueue;
}

void scheduleMermaidRender();

const observer = new MutationObserver((mutations) => {
  if (mutations.some((mutation) => mutation.attributeName === 'data-theme')) {
    void scheduleMermaidRender();
  }
});
observer.observe(document.documentElement, {
  attributes: true,
  attributeFilter: ['data-theme'],
});
</script>`;
}
