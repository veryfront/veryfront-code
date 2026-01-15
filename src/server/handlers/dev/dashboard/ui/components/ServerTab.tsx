import { useEffect, useState } from "react";
import { Card } from "./Card.tsx";
import { ErrorState, LoadingState, PageLayout } from "./shared.tsx";

type SubTab = "handlers" | "build";

interface Handler {
  name: string;
  priority: number;
  patterns: Array<{ pattern: string }>;
  enabled: string;
}

interface TransformStage {
  stage: number;
  name: string;
  description: string;
}

interface Plugin {
  name: string;
  description: string;
}

export function ServerTab() {
  const [subTab, setSubTab] = useState<SubTab>("handlers");
  const [handlers, setHandlers] = useState<Handler[]>([]);
  const [build, setBuild] = useState<
    {
      transformStages: TransformStage[];
      remarkPlugins: Plugin[];
      rehypePlugins: Plugin[];
    } | null
  >(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      fetch("/_dev/api/handlers").then((r) => r.json()),
      fetch("/_dev/api/build").then((r) => r.json()),
    ])
      .then(([h, b]) => {
        setHandlers(h.handlers || []);
        setBuild(b);
        setError(null);
      })
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <PageLayout title="Server" description="Request handling and build pipeline">
        <Card>
          <LoadingState message="Loading server info..." />
        </Card>
      </PageLayout>
    );
  }

  if (error) {
    return (
      <PageLayout title="Server" description="Request handling and build pipeline">
        <Card>
          <ErrorState error={error} />
        </Card>
      </PageLayout>
    );
  }

  return (
    <PageLayout title="Server" description="Request handling and build pipeline">
      <div className="flex gap-1 mb-6 border-b border-gray-200 pb-2">
        <TabButton
          active={subTab === "handlers"}
          onClick={() => setSubTab("handlers")}
          label={`Handlers (${handlers.length})`}
        />
        <TabButton
          active={subTab === "build"}
          onClick={() => setSubTab("build")}
          label={`Build (${build?.transformStages.length || 0} stages)`}
        />
      </div>

      {subTab === "handlers" && <HandlersSection handlers={handlers} />}
      {subTab === "build" && build && <BuildSection build={build} />}
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

function HandlersSection({ handlers }: { handlers: Handler[] }) {
  return (
    <Card title="REQUEST HANDLER CHAIN">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-gray-50 border-b">
            <th className="text-left px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-gray-500 w-20">
              Priority
            </th>
            <th className="text-left px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
              Handler
            </th>
            <th className="text-left px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
              Patterns
            </th>
          </tr>
        </thead>
        <tbody>
          {handlers.map((h, i) => (
            <tr key={i} className="border-b last:border-0">
              <td className="px-3 py-2">
                <span className="px-1.5 py-0.5 bg-gray-100 text-gray-600 text-[10px] font-mono rounded">
                  {h.priority}
                </span>
              </td>
              <td className="px-3 py-2">
                <code className="text-xs text-sky-600 font-medium">{h.name}</code>
              </td>
              <td className="px-3 py-2 text-gray-500 text-xs truncate max-w-xs">
                {h.patterns.map((p) => p.pattern).join(", ") || "*"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

function BuildSection({
  build,
}: {
  build: { transformStages: TransformStage[]; remarkPlugins: Plugin[]; rehypePlugins: Plugin[] };
}) {
  return (
    <>
      <Card title="TRANSFORM PIPELINE" className="mb-4">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b">
              <th className="text-left px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-gray-500 w-16">
                Stage
              </th>
              <th className="text-left px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                Name
              </th>
              <th className="text-left px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                Purpose
              </th>
            </tr>
          </thead>
          <tbody>
            {build.transformStages.map((stage) => (
              <tr key={stage.stage} className="border-b last:border-0">
                <td className="px-3 py-2 text-gray-500">{stage.stage}</td>
                <td className="px-3 py-2">
                  <code className="text-xs text-sky-600 font-medium">{stage.name}</code>
                </td>
                <td className="px-3 py-2 text-gray-600 text-sm">{stage.description}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <div className="grid grid-cols-2 gap-4">
        <Card title={`REMARK (${build.remarkPlugins.length})`}>
          <div className="divide-y">
            {build.remarkPlugins.map((p) => (
              <div key={p.name} className="px-3 py-2">
                <code className="text-xs text-purple-600 font-medium">{p.name}</code>
                <div className="text-xs text-gray-500 mt-0.5">{p.description}</div>
              </div>
            ))}
          </div>
        </Card>
        <Card title={`REHYPE (${build.rehypePlugins.length})`}>
          <div className="divide-y">
            {build.rehypePlugins.map((p) => (
              <div key={p.name} className="px-3 py-2">
                <code className="text-xs text-teal-600 font-medium">{p.name}</code>
                <div className="text-xs text-gray-500 mt-0.5">{p.description}</div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </>
  );
}
