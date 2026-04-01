import { PanelTab } from "./types";

type InterviewPanelTabsProps = {
  activeTab: PanelTab;
  onTabChange: (tab: PanelTab) => void;
};

const tabs: { id: PanelTab; label: string }[] = [
  { id: "progress", label: "当前进展" },
  { id: "queue", label: "题目" },
  { id: "retrospect", label: "复盘" },
];

export function InterviewPanelTabs({ activeTab, onTabChange }: InterviewPanelTabsProps) {
  return (
    <div className="rounded-xl bg-secondary/70 p-1">
      <div className="grid grid-cols-3 gap-1">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            className={`rounded-[1rem] px-2.5 py-2 text-xs font-medium sm:px-3 sm:text-sm ${
              tab.id === activeTab
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:bg-background/70 hover:text-foreground"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>
    </div>
  );
}
