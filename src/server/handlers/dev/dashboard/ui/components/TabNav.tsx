import type { TabId } from "../App.tsx";

interface TabNavProps {
  tabs: { id: TabId; label: string }[];
  currentTab: TabId;
  onTabChange: (tab: TabId) => void;
}

export function TabNav({ tabs, currentTab, onTabChange }: TabNavProps) {
  return (
    <nav className="bg-white border-b border-gray-200 px-5 flex gap-0.5">
      {tabs.map((tab) => (
        <button
          type="button"
          key={tab.id}
          onClick={() => onTabChange(tab.id)}
          className={`px-3 py-2.5 text-xs font-medium border-b-2 -mb-px transition-colors ${
            currentTab === tab.id
              ? "text-sky-500 border-sky-500"
              : "text-gray-400 border-transparent hover:text-gray-600"
          }`}
        >
          {tab.label}
        </button>
      ))}
    </nav>
  );
}
