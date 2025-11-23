export default function ErrorBoundary({ error }: { error?: unknown }) {
  return (
    <div>
      <h3>Docs Error</h3>
      <pre>{String((error as any)?.message ?? error ?? "Unknown error")}</pre>
    </div>
  );
}
