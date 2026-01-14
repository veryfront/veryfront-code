import { useEffect, useState } from "react";
import { Card } from "./Card.tsx";
import { LoadingState, PageLayout } from "./shared.tsx";

export function DebugTab() {
  const [content, setContent] = useState<string>("Loading...");
  const [loading, setLoading] = useState(true);

  function loadDebug() {
    setLoading(true);
    fetch("/_vf_debug/context")
      .then((res) => res.json())
      .then((d) => setContent(JSON.stringify(d, null, 2)))
      .catch((e) => setContent(`Error: ${(e as Error).message}`))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    loadDebug();
  }, []);

  return (
    <PageLayout title="Debug" description="Runtime context and configuration">
      <Card
        title="Context"
        titleRight={
          <button
            type="button"
            onClick={loadDebug}
            disabled={loading}
            className="px-3 py-1 bg-white border border-gray-200 text-xs text-gray-600 rounded hover:bg-gray-50 disabled:opacity-50"
          >
            Refresh
          </button>
        }
      >
        {loading
          ? <LoadingState />
          : (
            <pre className="p-4 text-xs font-mono text-gray-600 overflow-auto max-h-[450px] whitespace-pre-wrap bg-gray-50">{content}</pre>
          )}
      </Card>
    </PageLayout>
  );
}
