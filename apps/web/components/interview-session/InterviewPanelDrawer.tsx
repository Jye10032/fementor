import { X } from "lucide-react";
import { InterviewPanelTabs } from "./InterviewPanelTabs";
import { InterviewProgressTab } from "./InterviewProgressTab";
import { InterviewQuestionTab } from "./InterviewQuestionTab";
import { InterviewRetrospectTab } from "./InterviewRetrospectTab";
import { PanelTab, RetrospectResponse, TurnRecord, InterviewQuestion } from "./types";

type InterviewPanelDrawerProps = {
  isOpen: boolean;
  panelTab: PanelTab;
  onClose: () => void;
  onTabChange: (tab: PanelTab) => void;
  answeredCount: number;
  totalCount: number;
  averageScore: number | null;
  latestTurn: TurnRecord | null;
  stageLabel: string;
  queueItems: InterviewQuestion[];
  currentQuestionId: string | null;
  pendingNextQuestionId: string | null;
  retrospect: RetrospectResponse | null;
  queueLoading: boolean;
  retrospecting: boolean;
  finishing: boolean;
  canRetrospect: boolean;
  onRefresh: () => void;
  onRetrospect: () => void;
  onFinish: () => void;
  debugOutput?: string;
};

export function InterviewPanelDrawer({
  isOpen,
  panelTab,
  onClose,
  onTabChange,
  answeredCount,
  totalCount,
  averageScore,
  latestTurn,
  stageLabel,
  queueItems,
  currentQuestionId,
  pendingNextQuestionId,
  retrospect,
  queueLoading,
  retrospecting,
  finishing,
  canRetrospect,
  onRefresh,
  onRetrospect,
  onFinish,
  debugOutput,
}: InterviewPanelDrawerProps) {
  return (
    <div
      className={`fixed inset-0 z-50 transition ${
        isOpen ? "pointer-events-auto" : "pointer-events-none"
      }`}
      aria-hidden={!isOpen}
    >
      <div
        onClick={onClose}
        className={`absolute inset-0 bg-foreground/18 backdrop-blur-[1px] transition-opacity ${
          isOpen ? "opacity-100" : "opacity-0"
        }`}
      />
      <div className="absolute inset-x-3 bottom-[calc(env(safe-area-inset-bottom)+0.75rem)] top-auto flex justify-end lg:inset-x-auto lg:bottom-4 lg:right-4 lg:top-20">
        <aside
          className={`flex h-[min(76dvh,720px)] w-full max-w-[440px] flex-col overflow-hidden overscroll-contain rounded-[1.6rem] border border-border/80 bg-card/98 shadow-[var(--shadow-soft)] transition-transform duration-200 lg:h-[calc(100dvh-6rem)] lg:rounded-[2rem] ${
            isOpen ? "translate-y-0 opacity-100" : "translate-y-6 opacity-0 lg:translate-x-8"
          }`}
        >
          <div className="flex items-center justify-between border-b border-border/80 px-4 py-4 sm:px-5">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">面试面板</p>
              <p className="mt-1 text-sm text-foreground">查看当前进展、题目地图与复盘信息</p>
            </div>
            <button
              onClick={onClose}
              className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-border bg-background/90 text-muted-foreground hover:bg-secondary hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="border-b border-border/80 px-4 py-4 sm:px-5">
            <InterviewPanelTabs activeTab={panelTab} onTabChange={onTabChange} />
          </div>

          <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-5 sm:py-5">
            {panelTab === "progress" ? (
              <InterviewProgressTab
                answeredCount={answeredCount}
                totalCount={totalCount}
                averageScore={averageScore}
                latestTurn={latestTurn}
                stageLabel={stageLabel}
                queueLoading={queueLoading}
                retrospecting={retrospecting}
                finishing={finishing}
                canRetrospect={canRetrospect}
                onRefresh={onRefresh}
                onRetrospect={onRetrospect}
                onFinish={onFinish}
              />
            ) : null}
            {panelTab === "queue" ? (
              <InterviewQuestionTab
                queueItems={queueItems}
                currentQuestionId={currentQuestionId}
                pendingNextQuestionId={pendingNextQuestionId}
              />
            ) : null}
            {panelTab === "retrospect" ? <InterviewRetrospectTab retrospect={retrospect} /> : null}

            {debugOutput ? (
              <details className="mt-5 rounded-[1.4rem] border border-border/80 bg-background/75 p-4">
                <summary className="cursor-pointer text-sm font-semibold text-foreground">开发调试信息</summary>
                <pre className="mt-4 max-h-64 overflow-auto whitespace-pre-wrap text-xs leading-6 text-muted-foreground">
                  {debugOutput}
                </pre>
              </details>
            ) : null}
          </div>
        </aside>
      </div>
    </div>
  );
}
