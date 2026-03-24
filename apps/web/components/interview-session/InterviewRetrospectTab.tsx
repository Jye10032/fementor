import { RetrospectSummary } from "./RetrospectSummary";
import { RetrospectResponse } from "./types";

type InterviewRetrospectTabProps = {
  retrospect: RetrospectResponse | null;
};

export function InterviewRetrospectTab({ retrospect }: InterviewRetrospectTabProps) {
  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">复盘总结</p>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          用统一结构查看本场表现沉淀、优先补强项和岗位匹配信号。
        </p>
      </div>
      <RetrospectSummary retrospect={retrospect} variant="panel" />
    </div>
  );
}
