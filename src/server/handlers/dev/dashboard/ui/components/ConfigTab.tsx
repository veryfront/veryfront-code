import { useEffect, useState } from "react";
import { Card } from "./Card.tsx";
import { ErrorState, LoadingState, PageLayout } from "./shared.tsx";

type SubTab = "settings" | "debug";

interface FeatureFlag {
  name: string;
  value: boolean;
  source: string;
}

interface ConfigData {
  featureFlags: FeatureFlag[];
  environment: Record<string, string | boolean>;
  projectDir: string;
  mode: string;
  timestamp: string;
}

export function ConfigTab() {
  const [subTab, setSubTab] = useState<SubTab>("settings");
  const [data, setData] = useState<ConfigData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [debugContent, setDebugContent] = useState<string>("");
  const [debugLoading, setDebugLoading] = useState(true);

  function loadConfig() {
    setLoading(true);
    fetch("/_dev/api/config")
      .then((res) => res.json())
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }

  function loadDebug() {
    setDebugLoading(true);
    fetch("/_vf_debug/context")
      .then((res) => res.json())
      .then((d) => setDebugContent(JSON.stringify(d, null, 2)))
      .catch((e) => setDebugContent(`Error: ${(e as Error).message}`))
      .finally(() => setDebugLoading(false));
  }

  useEffect(() => {
    loadConfig();
    loadDebug();
  }, []);

  if (loading && !data) {
    return (
      <PageLayout title="Config" description="Configuration, environment, and runtime context">
        <Card>
          <LoadingState message="Loading configuration..." />
        </Card>
      </PageLayout>
    );
  }

  if (error && !data) {
    return (
      <PageLayout title="Config" description="Configuration, environment, and runtime context">
        <Card>
          <ErrorState error={error} />
        </Card>
      </PageLayout>
    );
  }

  return (
    <PageLayout title="Config" description="Configuration, environment, and runtime context">
      <div className="flex items-center justify-between mb-6">
        <div className="flex gap-1 border-b border-gray-200 pb-2">
          <TabButton
            active={subTab === "settings"}
            onClick={() => setSubTab("settings")}
            label="Settings"
          />
          <TabButton
            active={subTab === "debug"}
            onClick={() => setSubTab("debug")}
            label="Debug"
          />
        </div>
        <button
          type="button"
          onClick={() => {
            loadConfig();
            loadDebug();
          }}
          disabled={loading || debugLoading}
          className="px-3 py-1.5 bg-white border border-gray-200 text-sm text-gray-600 rounded hover:bg-gray-50 disabled:opacity-50"
        >
          Refresh
        </button>
      </div>

      {subTab === "settings" && <SettingsSection data={data} />}
      {subTab === "debug" && <DebugSection content={debugContent} loading={debugLoading} />}
    </PageLayout>
  );
}

function TabButton({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-3 py-1.5 text-sm font-medium rounded-t transition-colors ${
        active
          ? "bg-white text-sky-600 border border-gray-200 border-b-white -mb-[1px]"
          : "text-gray-500 hover:text-gray-700"
      }`}
    >
      {label}
    </button>
  );
}

function SettingsSection({ data }: { data: ConfigData | null }) {
  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
        <Card className="p-4">
          <div className="text-xs text-gray-500 uppercase mb-1">Mode</div>
          <div className="text-lg font-semibold text-gray-900">{data?.mode || "unknown"}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-gray-500 uppercase mb-1">Project Directory</div>
          <code className="text-sm text-sky-600 break-all">{data?.projectDir}</code>
        </Card>
      </div>

      <Card title="FEATURE FLAGS" className="mb-4">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b">
              <th className="text-left px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                Flag
              </th>
              <th className="text-left px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                Value
              </th>
              <th className="text-left px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                Source
              </th>
            </tr>
          </thead>
          <tbody>
            {data?.featureFlags.map((flag) => (
              <tr key={flag.name} className="border-b last:border-0">
                <td className="px-3 py-2.5">
                  <code className="text-xs text-sky-600 font-medium">{flag.name}</code>
                </td>
                <td className="px-3 py-2.5">
                  {flag.value
                    ? (
                      <span className="inline-flex items-center gap-1.5 text-green-600">
                        <span className="w-2 h-2 rounded-full bg-green-500" />
                        Enabled
                      </span>
                    )
                    : (
                      <span className="inline-flex items-center gap-1.5 text-gray-400">
                        <span className="w-2 h-2 rounded-full bg-gray-300" />
                        Disabled
                      </span>
                    )}
                </td>
                <td className="px-3 py-2.5">
                  <code className="text-xs text-gray-500">{flag.source}</code>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card title="ENVIRONMENT VARIABLES">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b">
              <th className="text-left px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                Variable
              </th>
              <th className="text-left px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                Value
              </th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(data?.environment || {}).map(([key, value]) => (
              <tr key={key} className="border-b last:border-0">
                <td className="px-3 py-2.5">
                  <code className="text-xs text-sky-600 font-medium">{key}</code>
                </td>
                <td className="px-3 py-2.5">
                  {typeof value === "string" && value.includes("(set)")
                    ? <span className="text-green-600 text-sm">{value}</span>
                    : typeof value === "string" && value.includes("(not set)")
                    ? <span className="text-gray-400 text-sm">{value}</span>
                    : <span className="text-gray-900 text-sm">{String(value)}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </>
  );
}

function DebugSection({ content, loading }: { content: string; loading: boolean }) {
  return (
    <Card title="RUNTIME CONTEXT">
      {loading
        ? <LoadingState message="Loading debug context..." />
        : (
          <pre className="p-4 text-xs font-mono text-gray-600 overflow-auto max-h-[500px] whitespace-pre-wrap bg-gray-50">
          {content}
          </pre>
        )}
    </Card>
  );
}
