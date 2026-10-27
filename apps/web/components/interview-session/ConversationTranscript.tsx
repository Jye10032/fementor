import { RefObject } from "react";
import { AgentActivity, LiveActivity } from "./AgentActivity";
import { getConversationLabel } from "./copy";
import { ConversationRow } from "./types";

type ConversationTranscriptProps = {
  conversationRows: ConversationRow[];
  scrollContainerRef: RefObject<HTMLDivElement>;
  transcriptEndRef: RefObject<HTMLDivElement>;
  live?: LiveActivity | null;
};

const assistantBubble = "max-w-[88%] rounded-[24px] rounded-tl-md border border-border bg-background/92 px-4 py-3 shadow-sm";

export function ConversationTranscript({
  conversationRows,
  scrollContainerRef,
  transcriptEndRef,
  live = null,
}: ConversationTranscriptProps) {
  // A recovered submission may have no cached row; keep its status visible.
  const orphanLive = live && (live.busy || live.canRefresh) && !conversationRows.some((row) => row.id === live.rowId);
  return (
    <div ref={scrollContainerRef} className="flex-1 overflow-y-auto overscroll-contain px-4 py-4 md:px-6">
      <div className="mx-auto space-y-4">
        {conversationRows.map((item) => {
          const rowLive = live?.rowId === item.id ? live : null;
          return (
            <article
              key={item.id}
              className={item.role === "assistant" ? "flex justify-start" : "flex justify-end"}
            >
              <div
                className={
                  item.role === "assistant"
                    ? assistantBubble
                    : "max-w-[88%] rounded-[24px] rounded-tr-md bg-primary px-4 py-3 text-primary-foreground shadow-sm"
                }
              >
                <p
                  className={
                    item.role === "assistant"
                      ? "text-[11px] text-muted-foreground"
                      : "text-[11px] text-primary-foreground/80"
                  }
                >
                  {getConversationLabel(item)}
                </p>
                {item.role === "assistant" && (
                  <AgentActivity activity={item.activity} live={rowLive} failed={item.kind === "notice"} />
                )}
                {item.content && <p className="mt-1 whitespace-pre-wrap text-sm leading-7">{item.content}</p>}
                {item.decision?.reason && (
                  <details className="mt-3 border-t border-border/70 pt-2 text-xs text-muted-foreground">
                    <summary className="cursor-pointer py-1">面试官的下一步安排</summary>
                    <p className="mt-1 whitespace-pre-wrap leading-6">{item.decision.reason}</p>
                  </details>
                )}
              </div>
            </article>
          );
        })}
        {orphanLive && (
          <article className="flex justify-start">
            <div className={assistantBubble}>
              <p className="text-[11px] text-muted-foreground">面试官</p>
              <AgentActivity live={live} />
            </div>
          </article>
        )}
        <div ref={transcriptEndRef} />
      </div>
    </div>
  );
}
