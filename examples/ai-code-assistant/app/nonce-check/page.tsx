'use client';

import { useEffect, useState } from 'react';

interface NonceCheckResult {
  match: boolean;
  cspNonce: string | null;
  htmlNonce: string | null;
  totalScripts: number;
  uniqueNonces: number;
  error?: string;
}

export default function NonceCheckPage() {
  const [result, setResult] = useState<NonceCheckResult | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function checkNonces() {
      try {
        // Get CSP header via fetch
        const response = await fetch(window.location.origin);
        const cspHeader = response.headers.get('content-security-policy');

        // Extract nonce from CSP header
        const cspNonceMatch = cspHeader ? cspHeader.match(/'nonce-([^']+)'/) : null;
        const cspNonce = cspNonceMatch ? cspNonceMatch[1] : null;

        // Get all script nonces from DOM
        const scriptNonces = Array.from(document.querySelectorAll('script[nonce]'))
          .map(s => s.getAttribute('nonce'))
          .filter((v, i, a) => a.indexOf(v) === i); // unique

        const htmlNonce = scriptNonces[0] || null;
        const match = cspNonce && htmlNonce && cspNonce === htmlNonce;

        setResult({
          match,
          cspNonce,
          htmlNonce,
          totalScripts: scriptNonces.length,
          uniqueNonces: scriptNonces.length,
        });
      } catch (error) {
        setResult({
          match: false,
          cspNonce: null,
          htmlNonce: null,
          totalScripts: 0,
          uniqueNonces: 0,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      } finally {
        setLoading(false);
      }
    }

    checkNonces();
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 p-8">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-4xl font-bold text-white mb-4">CSP Nonce Diagnostic Tool</h1>
        <p className="text-slate-300 mb-8">
          This page checks if CSP nonces match between headers and inline scripts.
        </p>

        {loading ? (
          <div className="bg-slate-800 rounded-lg p-8 border border-slate-700">
            <p className="text-slate-400">Checking nonces...</p>
          </div>
        ) : result?.error ? (
          <div className="bg-red-900/20 border-2 border-red-500 rounded-lg p-8">
            <h2 className="text-2xl font-bold text-red-400 mb-4">✗ ERROR</h2>
            <p className="text-red-300">Failed to check nonces: {result.error}</p>
          </div>
        ) : result?.match ? (
          <div className="bg-green-900/20 border-2 border-green-500 rounded-lg p-8">
            <h2 className="text-2xl font-bold text-green-400 mb-4">✓ NONCES MATCH</h2>
            <div className="space-y-2 text-slate-200">
              <p>
                <strong>CSP Header Nonce:</strong>{' '}
                <span className="font-mono text-blue-400">{result.cspNonce}</span>
              </p>
              <p>
                <strong>HTML Script Nonce:</strong>{' '}
                <span className="font-mono text-blue-400">{result.htmlNonce}</span>
              </p>
              <p>
                <strong>Total Scripts with Nonce:</strong> {result.totalScripts}
              </p>
              <p>
                <strong>Unique Nonces Found:</strong> {result.uniqueNonces}
              </p>
            </div>
          </div>
        ) : (
          <div className="bg-red-900/20 border-2 border-red-500 rounded-lg p-8">
            <h2 className="text-2xl font-bold text-red-400 mb-4">✗ NONCES MISMATCH</h2>
            <div className="space-y-2 text-slate-200">
              <p>
                <strong>CSP Header Nonce:</strong>{' '}
                <span className="font-mono text-blue-400">
                  {result?.cspNonce || 'NOT FOUND'}
                </span>
              </p>
              <p>
                <strong>HTML Script Nonce:</strong>{' '}
                <span className="font-mono text-blue-400">
                  {result?.htmlNonce || 'NOT FOUND'}
                </span>
              </p>
              <p>
                <strong>Total Scripts with Nonce:</strong> {result?.totalScripts}
              </p>
              <p>
                <strong>Unique Nonces Found:</strong> {result?.uniqueNonces}
              </p>
              <p className="text-red-300 mt-4">
                <strong>ACTION REQUIRED:</strong> Clear cache and hard refresh (Ctrl+Shift+R / Cmd+Shift+R)
              </p>
            </div>
          </div>
        )}

        <div className="mt-8 bg-slate-800 rounded-lg p-6 border border-slate-700">
          <h3 className="text-xl font-bold text-white mb-4">How Nonces Work</h3>
          <div className="text-slate-300 space-y-2 text-sm">
            <p>
              1. <strong>Server generates a unique nonce</strong> for each request (e.g., "qpHEKS8x4eWKlqb2stQp0Q==")
            </p>
            <p>
              2. <strong>CSP header includes the nonce:</strong>{' '}
              <code className="text-blue-400">script-src 'self' 'nonce-qpHEKS8x4eWKlqb2stQp0Q=='</code>
            </p>
            <p>
              3. <strong>All inline scripts get the nonce attribute:</strong>{' '}
              <code className="text-blue-400">&lt;script nonce="qpHEKS8x4eWKlqb2stQp0Q=="&gt;</code>
            </p>
            <p>
              4. <strong>Browser allows only scripts with matching nonce</strong> to execute
            </p>
            <p className="mt-4 text-yellow-400">
              <strong>Note:</strong> Static HTML files in public/ directory won't have dynamic nonces.
              Use SSR routes (like this page) for proper nonce support.
            </p>
          </div>
        </div>

        <div className="mt-6 text-center">
          <a
            href="/"
            className="inline-block bg-purple-600 hover:bg-purple-700 text-white rounded-lg px-6 py-3 font-medium transition-colors"
          >
            Back to Home
          </a>
        </div>
      </div>
    </div>
  );
}
