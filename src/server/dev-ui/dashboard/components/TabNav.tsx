import type { TabId } from "../App.tsx";

interface TabNavProps {
  tabs: { id: TabId; label: string }[];
  currentTab: TabId;
  onTabChange: (tab: TabId) => void;
}

export function TabNav({ tabs, currentTab, onTabChange }: TabNavProps): JSX.Element {
  return (
    <nav className="bg-white border-b border-gray-200 px-5 flex gap-0.5">
      {tabs.map((tab) => {
        const isActive = currentTab === tab.id;

        let className = "px-3 py-2.5 text-xs font-medium border-b-2 -mb-px transition-colors ";
        if (isActive) {
          className += "text-sky-500 border-sky-500";
        } else {
          className += "text-gray-400 border-transparent hover:text-gray-600";
        }

        return (
          <button
            key={tab.id}
            type="button"
            className={className}
            onClick={() => onTabChange(tab.id)}
          >
            {tab.label}
          </button>
        );
      })}
    </nav>
  );
}
