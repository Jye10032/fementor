import { RefObject } from "react";
import { getConversationLabel } from "./copy";
import { ConversationRow } from "./types";

type ConversationTranscriptProps = {
  conversationRows: ConversationRow[];
  scrollContainerRef: RefObject<HTMLDivElement>;
  transcriptEndRef: RefObject<HTMLDivElement>;
};

export function ConversationTranscript({
  conversationRows,
  scrollContainerRef,
  transcriptEndRef,
}: ConversationTranscriptProps) {
  return (
    <div ref={scrollContainerRef} className="flex-1 overflow-y-auto overscroll-contain px-4 py-5 md:px-6">
      <div className="mx-auto max-w-4xl space-y-4">
        {conversationRows.map((item) => (
          <article
            key={item.id}
            className={item.role === "assistant" ? "flex justify-start" : "flex justify-end"}
          >
            <div
              className={
                item.role === "assistant"
                  ? "max-w-[82%] rounded-[24px] rounded-tl-md border border-border bg-background/92 px-4 py-3 shadow-sm"
                  : "max-w-[82%] rounded-[24px] rounded-tr-md bg-primary px-4 py-3 text-primary-foreground shadow-sm"
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
              <p className="mt-1 whitespace-pre-wrap text-sm leading-7">{item.content}</p>
            </div>
          </article>
        ))}
        <div ref={transcriptEndRef} />
      </div>
    </div>
  );
}
