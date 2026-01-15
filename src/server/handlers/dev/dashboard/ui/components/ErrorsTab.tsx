import { useEffect, useState } from "react";
import { Card } from "./Card.tsx";
import { ErrorState, LoadingState, PageLayout } from "./shared.tsx";

interface ErrorEntry {
  code: string;
  title: string;
  category: string;
  message: string;
  steps?: string[];
  docsUrl?: string;
}

interface ErrorsData {
  errors: ErrorEntry[];
  categories: Record<string, number>;
  count: number;
  timestamp: string;
}

export function ErrorsTab() {
  const [data, setData] = useState<ErrorsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedError, setSelectedError] = useState<ErrorEntry | null>(null);

  function loadData() {
    setLoading(true);
    fetch("/_dev/api/errors")
      .then((res) => res.json())
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    loadData();
  }, []);

  if (loading) {
    return (
      <PageLayout title="Errors" description="Error catalog and solutions">
        <Card>
          <LoadingState message="Loading error catalog..." />
        </Card>
      </PageLayout>
    );
  }

  if (error) {
    return (
      <PageLayout title="Errors" description="Error catalog and solutions">
        <Card>
          <ErrorState error={error} />
        </Card>
      </PageLayout>
    );
  }

  const filteredErrors = data?.errors.filter((err) => {
    const matchesSearch = !search ||
      err.code.toLowerCase().includes(search.toLowerCase()) ||
      err.title.toLowerCase().includes(search.toLowerCase()) ||
      err.message.toLowerCase().includes(search.toLowerCase());
    const matchesCategory = !selectedCategory || err.category === selectedCategory;
    return matchesSearch && matchesCategory;
  }) || [];

  const categoryColors: Record<string, string> = {
    config: "bg-blue-100 text-blue-700",
    build: "bg-purple-100 text-purple-700",
    runtime: "bg-orange-100 text-orange-700",
    route: "bg-green-100 text-green-700",
    module: "bg-pink-100 text-pink-700",
    server: "bg-red-100 text-red-700",
    rsc: "bg-cyan-100 text-cyan-700",
    dev: "bg-yellow-100 text-yellow-700",
    deployment: "bg-indigo-100 text-indigo-700",
    general: "bg-gray-100 text-gray-700",
  };

  return (
    <PageLayout title="Errors" description={`Error catalog (${data?.count || 0} codes)`}>
      <div className="mb-4">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search errors..."
          className="w-full max-w-md px-3 py-1.5 bg-white border border-gray-200 rounded text-sm focus:outline-none focus:border-sky-500"
        />
      </div>

      <Card title="CATEGORIES" className="mb-4">
        <div className="p-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setSelectedCategory(null)}
            className={`px-3 py-1.5 text-sm font-medium rounded-full transition-colors ${
              selectedCategory === null
                ? "bg-sky-500 text-white"
                : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            }`}
          >
            All ({data?.count || 0})
          </button>
          {Object.entries(data?.categories || {})
            .sort()
            .map(([cat, count]) => (
              <button
                type="button"
                key={cat}
                onClick={() => setSelectedCategory(cat === selectedCategory ? null : cat)}
                className={`px-3 py-1.5 text-sm font-medium rounded-full transition-colors ${
                  selectedCategory === cat
                    ? "bg-sky-500 text-white"
                    : categoryColors[cat] || "bg-gray-100 text-gray-700"
                }`}
              >
                {cat} ({count})
              </button>
            ))}
        </div>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card title={`ERRORS (${filteredErrors.length})`} className="max-h-[600px] overflow-y-auto">
          <div className="divide-y">
            {filteredErrors.map((err) => (
              <button
                key={err.code}
                type="button"
                onClick={() => setSelectedError(err)}
                className={`w-full px-3 py-2.5 text-left hover:bg-gray-50 transition-colors ${
                  selectedError?.code === err.code ? "bg-sky-50" : ""
                }`}
              >
                <div className="flex items-center gap-2">
                  <code className="text-xs font-bold text-red-600">{err.code}</code>
                  <span
                    className={`px-1.5 py-0.5 text-[10px] font-medium rounded ${
                      categoryColors[err.category] || "bg-gray-100 text-gray-700"
                    }`}
                  >
                    {err.category}
                  </span>
                </div>
                <div className="text-sm text-gray-900 mt-1">{err.title}</div>
              </button>
            ))}
          </div>
        </Card>

        <Card title="ERROR DETAILS">
          {selectedError
            ? (
              <div className="p-4">
                <div className="mb-4">
                  <code className="text-lg font-bold text-red-600">{selectedError.code}</code>
                  <h3 className="text-lg font-semibold text-gray-900 mt-1">
                    {selectedError.title}
                  </h3>
                  <span
                    className={`inline-block mt-2 px-2 py-0.5 text-xs font-medium rounded ${
                      categoryColors[selectedError.category] || "bg-gray-100 text-gray-700"
                    }`}
                  >
                    {selectedError.category}
                  </span>
                </div>

                <div className="mb-4">
                  <div className="text-xs font-semibold text-gray-500 uppercase mb-1">Message</div>
                  <p className="text-sm text-gray-700">{selectedError.message}</p>
                </div>

                {selectedError.steps && selectedError.steps.length > 0 && (
                  <div className="mb-4">
                    <div className="text-xs font-semibold text-gray-500 uppercase mb-2">
                      Resolution Steps
                    </div>
                    <ol className="list-decimal list-inside space-y-1">
                      {selectedError.steps.map((step, idx) => (
                        <li key={idx} className="text-sm text-gray-700">
                          {step}
                        </li>
                      ))}
                    </ol>
                  </div>
                )}

                {selectedError.docsUrl && (
                  <a
                    href={selectedError.docsUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-sm text-sky-600 hover:text-sky-700"
                  >
                    View Documentation
                    <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                      <path
                        fillRule="evenodd"
                        d="M5.22 14.78a.75.75 0 001.06 0l7.22-7.22v5.69a.75.75 0 001.5 0v-7.5a.75.75 0 00-.75-.75h-7.5a.75.75 0 000 1.5h5.69l-7.22 7.22a.75.75 0 000 1.06z"
                        clipRule="evenodd"
                      />
                    </svg>
                  </a>
                )}
              </div>
            )
            : <div className="p-4 text-sm text-gray-400">Select an error to view details</div>}
        </Card>
      </div>
    </PageLayout>
  );
}
