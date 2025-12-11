
export const CLIENT_STYLES = `body {
  margin: 0;
  font-family:
    -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
  line-height: 1.5;
}

.loading-container {
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 100vh;
  background: #f9fafb;
}

.loading-spinner {
  width: 40px;
  height: 40px;
  border: 3px solid #e5e7eb;
  border-top-color: #3b82f6;
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.error-container {
  max-width: 600px;
  margin: 2rem auto;
  padding: 2rem;
  background: #fee;
  border: 1px solid #fcc;
  border-radius: 8px;
  color: #c00;
}

.prose {
  max-width: 65ch;
  margin: 0 auto;
  padding: 2rem;
}

.prose h1, .prose h2, .prose h3 {
  margin-top: 2em;
  margin-bottom: 1em;
}

.prose p {
  margin-bottom: 1.5em;
}

.prose code {
  background: #f3f4f6;
  padding: 0.2em 0.4em;
  border-radius: 3px;
  font-size: 0.875em;
}

.prose pre {
  background: #1f2937;
  color: #f9fafb;
  padding: 1em;
  border-radius: 8px;
  overflow-x: auto;
}

.prose pre code {
  background: transparent;
  padding: 0;
  color: inherit;
}`;

export let CLIENT_ROUTER_BUNDLE: string | undefined;

export let CLIENT_PREFETCH_BUNDLE: string | undefined;
