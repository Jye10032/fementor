import { Check, LoaderCircle, Sparkles, Waypoints } from "lucide-react";
import { StageStep } from "./types";

const stageItems = [
  { id: "receiving", label: "接收回答" },
  { id: "evaluating", label: "评估回答" },
  { id: "transition", label: "准备下一题" },
  { id: "completed", label: "数据整理入库" },
] as const;

function getStageTone(step: StageStep) {
  if (step === "transition" || step === "completed") {
    return {
      icon: Waypoints,
      textClassName: "text-sky-600",
      badgeClassName: "bg-sky-100 text-sky-700",
      badgeLabel: step === "completed" ? "已完成" : "处理中",
    };
  }

  if (step === "idle") {
    return {
      icon: Sparkles,
      textClassName: "text-muted-foreground",
      badgeClassName: "bg-secondary text-muted-foreground",
      badgeLabel: "等待作答",
    };
  }

  return {
    icon: LoaderCircle,
    textClassName: "text-amber-600",
    badgeClassName: "bg-amber-100 text-amber-700",
    badgeLabel: "处理中",
  };
}

function getActiveStageIndex(step: StageStep) {
  if (step === "receiving") return 0;
  if (step === "evaluating" || step === "deciding" || step === "retrieving" || step === "generating_followup") return 1;
  if (step === "transition") return 2;
  if (step === "completed") return 3;
  return -1;
}

type StageStatusBarProps = {
  stageLabel: string;
  stageStep: StageStep;
};

export function StageStatusBar({ stageLabel, stageStep }: StageStatusBarProps) {
  const tone = getStageTone(stageStep);
  const Icon = tone.icon;
  const activeIndex = getActiveStageIndex(stageStep);

  return (
    <div className="pt-2">
      <div className={`flex items-center gap-2 text-xs ${tone.textClassName}`}>
        <Icon className={`h-3.5 w-3.5 shrink-0 ${stageStep === "idle" || stageStep === "completed" ? "" : "animate-spin"}`} />
        <span className="font-medium">{stageLabel}</span>
        <span className={`ml-auto rounded-full px-2.5 py-0.5 text-xs font-medium ${tone.badgeClassName}`}>
          {tone.badgeLabel}
        </span>
      </div>

      <div className="mt-2 flex items-center gap-0">
        {stageItems.map((item, index) => {
          const isDone = activeIndex > index;
          const isCurrent = activeIndex === index;

          return (
            <div key={item.id} className="flex flex-1 items-center">
              {/* dot */}
              <div className="flex flex-col items-center">
                <span
                  className={`relative inline-flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-semibold transition-colors ${
                    isCurrent
                      ? "bg-primary text-primary-foreground shadow-[0_0_0_3px_color-mix(in_oklab,var(--primary)_25%,transparent)]"
                      : isDone
                        ? "bg-sky-500 text-white"
                        : "bg-secondary text-muted-foreground"
                  }`}
                >
                  {isDone ? (
                    <Check className="h-3 w-3" />
                  ) : isCurrent ? (
                    <LoaderCircle className="h-3 w-3 animate-spin" />
                  ) : (
                    <span>{index + 1}</span>
                  )}
                </span>
                <span className={`mt-1 text-[10px] leading-tight ${
                  isCurrent ? "font-medium text-amber-700" : isDone ? "text-sky-700" : "text-muted-foreground"
                }`}>
                  {item.label}
                </span>
              </div>
              {/* connector line */}
              {index < stageItems.length - 1 ? (
                <div className={`mx-1 h-0.5 flex-1 rounded-full transition-colors ${
                  isDone ? "bg-sky-400" : "bg-border"
                }`} />
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
