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

export function ConfigTab(): React.JSX.Element {
  const [subTab, setSubTab] = useState<SubTab>("settings");
  const [data, setData] = useState<ConfigData | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [debugContent, setDebugContent] = useState<string>("");
  const [debugLoading, setDebugLoading] = useState<boolean>(true);

  function loadConfig(): void {
    setLoading(true);

    fetch("/_dev/api/config")
      .then((res) => res.json())
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => setLoading(false));
  }

  function loadDebug(): void {
    setDebugLoading(true);

    fetch("/_vf_debug/context")
      .then((res) => res.json())
      .then((d) => setDebugContent(JSON.stringify(d, null, 2)))
      .catch((e: unknown) => {
        const message = e instanceof Error ? e.message : String(e);
        setDebugContent(`Error: ${message}`);
      })
      .finally(() => setDebugLoading(false));
  }

  function refresh(): void {
    loadConfig();
    loadDebug();
  }

  useEffect(() => {
    refresh();
  }, []);

  const layoutProps = {
    title: "Config",
    description: "Configuration, environment, and runtime context",
  };

  if (loading && !data) {
    return (
      <PageLayout {...layoutProps}>
        <Card>
          <LoadingState message="Loading configuration..." />
        </Card>
      </PageLayout>
    );
  }

  if (error && !data) {
    return (
      <PageLayout {...layoutProps}>
        <Card>
          <ErrorState error={error} />
        </Card>
      </PageLayout>
    );
  }

  let content: React.JSX.Element;
  if (subTab === "settings") {
    content = <SettingsSection data={data} />;
  } else {
    content = <DebugSection content={debugContent} loading={debugLoading} />;
  }

  return (
    <PageLayout {...layoutProps}>
      <div className="flex items-center justify-between mb-6">
        <div className="flex gap-1 border-b border-gray-200 pb-2">
          <TabButton
            active={subTab === "settings"}
            onClick={() => setSubTab("settings")}
            label="Settings"
          />
          <TabButton active={subTab === "debug"} onClick={() => setSubTab("debug")} label="Debug" />
        </div>

        <button
          type="button"
          onClick={refresh}
          disabled={loading || debugLoading}
          className="px-3 py-1.5 bg-white border border-gray-200 text-sm text-gray-600 rounded hover:bg-gray-50 disabled:opacity-50"
        >
          Refresh
        </button>
      </div>

      {content}
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
}): React.JSX.Element {
  const className = active
    ? "px-3 py-1.5 text-sm font-medium rounded-t transition-colors bg-white text-sky-600 border border-gray-200 border-b-white -mb-[1px]"
    : "px-3 py-1.5 text-sm font-medium rounded-t transition-colors text-gray-500 hover:text-gray-700";

  return (
    <button type="button" onClick={onClick} className={className}>
      {label}
    </button>
  );
}

function SettingsSection({ data }: { data: ConfigData | null }): React.JSX.Element {
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
            {data?.featureFlags.map((flag) => {
              const valueEl = flag.value
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
                );

              return (
                <tr key={flag.name} className="border-b last:border-0">
                  <td className="px-3 py-2.5">
                    <code className="text-xs text-sky-600 font-medium">{flag.name}</code>
                  </td>
                  <td className="px-3 py-2.5">{valueEl}</td>
                  <td className="px-3 py-2.5">
                    <code className="text-xs text-gray-500">{flag.source}</code>
                  </td>
                </tr>
              );
            })}
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
            {Object.entries(data?.environment ?? {}).map(([key, value]) => {
              let className = "text-gray-900 text-sm";

              if (typeof value === "string") {
                if (value.includes("(set)")) {
                  className = "text-green-600 text-sm";
                } else if (value.includes("(not set)")) {
                  className = "text-gray-400 text-sm";
                }
              }

              return (
                <tr key={key} className="border-b last:border-0">
                  <td className="px-3 py-2.5">
                    <code className="text-xs text-sky-600 font-medium">{key}</code>
                  </td>
                  <td className="px-3 py-2.5">
                    <span className={className}>{String(value)}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
    </>
  );
}

function DebugSection(
  { content, loading }: { content: string; loading: boolean },
): React.JSX.Element {
  if (loading) {
    return (
      <Card title="RUNTIME CONTEXT">
        <LoadingState message="Loading debug context..." />
      </Card>
    );
  }

  return (
    <Card title="RUNTIME CONTEXT">
      <pre className="p-4 text-xs font-mono text-gray-600 overflow-auto max-h-[500px] whitespace-pre-wrap bg-gray-50">
        {content}
      </pre>
    </Card>
  );
}
