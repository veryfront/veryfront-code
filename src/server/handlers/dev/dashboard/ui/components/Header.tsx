import type { Stats } from "../App.tsx";

interface HeaderProps {
  stats: Stats | null;
}

export function Header({ stats }: HeaderProps) {
  return (
    <header className="bg-white border-b border-gray-200 px-5 h-12 flex items-center justify-between sticky top-0 z-50">
      <div className="flex items-center gap-2">
        <div className="w-6 h-6 bg-sky-500 rounded flex items-center justify-center text-white font-bold text-xs">
          V
        </div>
        <span className="font-semibold text-sm tracking-tight">Dev</span>
      </div>
      <div className="flex gap-4 text-xs text-gray-500">
        <span>
          Tools{" "}
          <span className="font-semibold text-gray-900 ml-1 tabular-nums">
            {stats?.mcp.tools ?? "-"}
          </span>
        </span>
        <span>
          Resources{" "}
          <span className="font-semibold text-gray-900 ml-1 tabular-nums">
            {stats?.mcp.resources ?? "-"}
          </span>
        </span>
        <span>
          Prompts{" "}
          <span className="font-semibold text-gray-900 ml-1 tabular-nums">
            {stats?.mcp.prompts ?? "-"}
          </span>
        </span>
        <span>
          Agents{" "}
          <span className="font-semibold text-gray-900 ml-1 tabular-nums">
            {stats?.agents ?? "-"}
          </span>
        </span>
      </div>
    </header>
  );
}
