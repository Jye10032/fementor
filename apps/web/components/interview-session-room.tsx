"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiRequest } from "../lib/api";
import { useAuthState } from "./auth-provider";
import { Composer } from "./interview-session/Composer";
import { ConversationTranscript } from "./interview-session/ConversationTranscript";
import { CurrentQuestionCard } from "./interview-session/CurrentQuestionCard";
import { InterviewCompletionReport } from "./interview-session/InterviewCompletionReport";
import { InterviewPanelDrawer } from "./interview-session/InterviewPanelDrawer";
import {
  buildConversationRowsFromTurns,
  formatElapsed,
  getStageDisplay,
  normalizePersistedTurnRecord,
  normalizeTurnRecord,
  reconcileQueueItems,
} from "./interview-session/copy";
import { SessionTopBar } from "./interview-session/SessionTopBar";
import { StageStatusBar } from "./interview-session/StageStatusBar";
import {
  ConversationRow,
  InterviewQuestion,
  InterviewSessionDetail,
  InterviewTurnHistoryItem,
  InterviewTurnStageEvent,
  InterviewTurnTokenEvent,
  PanelTab,
  Props,
  QuestionCardMode,
  QuestionQueueResponse,
  RetrospectResponse,
  StageStep,
  TurnHistoryResponse,
  TurnRecord,
  TurnResponse,
} from "./interview-session/types";
import { useRuntimeConfig } from "./runtime-config";

type LoadQueueOptions = {
  preserveDisplayedQuestion?: boolean;
  resetStageToIdle?: boolean;
};

function getInitialStageLabel(currentQuestion: InterviewQuestion | null) {
  return currentQuestion ? "等待你的回答" : "等待题目同步";
}

function getHistoryStorageKey(sessionId: string) {
  return `interview-session-history:${sessionId}`;
}

function isConversationRowList(value: unknown): value is ConversationRow[] {
  return Array.isArray(value) && value.every((item) => {
    if (!item || typeof item !== "object") return false;
    return (
      typeof (item as ConversationRow).id === "string" &&
      typeof (item as ConversationRow).role === "string" &&
      typeof (item as ConversationRow).kind === "string" &&
      typeof (item as ConversationRow).content === "string"
    );
  });
}

function isPersistedTurnList(value: unknown): value is InterviewTurnHistoryItem[] {
  return Array.isArray(value) && value.every((item) => {
    if (!item || typeof item !== "object") return false;
    return (
      typeof (item as InterviewTurnHistoryItem).id === "string" &&
      typeof (item as InterviewTurnHistoryItem).session_id === "string" &&
      typeof (item as InterviewTurnHistoryItem).turn_index === "number" &&
      typeof (item as InterviewTurnHistoryItem).question === "string" &&
      typeof (item as InterviewTurnHistoryItem).answer === "string"
    );
  });
}

export function InterviewSessionRoom({ initialSessionId }: Props) {
  const { apiBase } = useRuntimeConfig();
  const { getToken, isLoaded, isSignedIn } = useAuthState();
  const [sessionId] = useState(initialSessionId);
  const [answer, setAnswer] = useState("");
  const [turns, setTurns] = useState<TurnRecord[]>([]);
  const [conversationRows, setConversationRows] = useState<ConversationRow[]>([]);
  const [queueItems, setQueueItems] = useState<InterviewQuestion[]>([]);
  const [sessionDetail, setSessionDetail] = useState<InterviewSessionDetail | null>(null);
  const [currentQuestionId, setCurrentQuestionId] = useState<string | null>(null);
  const [pendingNextQuestion, setPendingNextQuestion] = useState<InterviewQuestion | null>(null);
  const [questionCardMode, setQuestionCardMode] = useState<QuestionCardMode>("active");
  const [stageStep, setStageStep] = useState<StageStep>("idle");
  const [stageLabel, setStageLabel] = useState("等待题目同步");
  const [isPanelOpen, setIsPanelOpen] = useState(false);
  const [panelTab, setPanelTab] = useState<PanelTab>("progress");
  const [showCompletionReport, setShowCompletionReport] = useState(false);
  const [retrospect, setRetrospect] = useState<RetrospectResponse | null>(null);
  const [output, setOutput] = useState("");
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [queueLoading, setQueueLoading] = useState(false);
  const [submittingTurn, setSubmittingTurn] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [retrospecting, setRetrospecting] = useState(false);
  const [startedAt] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  const pausedMsRef = useRef(0);
  const hiddenAtRef = useRef<number | null>(null);
  const questionViewportRef = useRef<HTMLDivElement>(null);
  const transcriptScrollRef = useRef<HTMLDivElement>(null);
  const transcriptEndRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const autoAdvanceTimerRef = useRef<number | null>(null);
  const restoredHistoryRef = useRef(false);

  const currentQuestion = useMemo(
    () => queueItems.find((item) => item.id === currentQuestionId) ?? null,
    [queueItems, currentQuestionId],
  );
  const latestTurn = useMemo(() => turns[turns.length - 1] ?? null, [turns]);
  const averageScore = useMemo(() => {
    if (turns.length === 0) return null;
    return Math.round(turns.reduce((sum, turn) => sum + (turn.score ?? 0), 0) / turns.length);
  }, [turns]);
  const answeredCount = useMemo(
    () => queueItems.filter((item) => item.status === "answered").length,
    [queueItems],
  );
  const interviewCompleted = useMemo(() => {
    if (showCompletionReport) return true;
    if (queueItems.length === 0) return false;
    return (
      queueItems.every((item) => item.status === "answered" || item.status === "skipped") &&
      !currentQuestion &&
      !pendingNextQuestion
    );
  }, [currentQuestion, pendingNextQuestion, queueItems, showCompletionReport]);
  const sessionClosed = sessionDetail?.status === "completed";
  const elapsedMs = useMemo(() => {
    if (sessionClosed && sessionDetail?.started_at) {
      const startedTime = new Date(sessionDetail.started_at).getTime();
      const endedTime = sessionDetail.ended_at ? new Date(sessionDetail.ended_at).getTime() : Date.now();

      if (Number.isFinite(startedTime) && Number.isFinite(endedTime) && endedTime >= startedTime) {
        return endedTime - startedTime;
      }
    }

    return now - startedAt - pausedMsRef.current;
  }, [now, sessionClosed, sessionDetail?.ended_at, sessionDetail?.started_at, startedAt]);

  const clearAutoAdvanceTimer = useCallback(() => {
    if (autoAdvanceTimerRef.current) {
      window.clearTimeout(autoAdvanceTimerRef.current);
      autoAdvanceTimerRef.current = null;
    }
  }, []);

  const updateEvaluationRow = (evaluationId: string, content: string) => {
    setConversationRows((previousRows) =>
      previousRows.map((row) => (row.id === evaluationId ? { ...row, content } : row)),
    );
  };

  const loadQuestionQueue = useCallback(async (options?: LoadQueueOptions) => {
    if (!sessionId) return;

    try {
      setQueueLoading(true);
      const data = await apiRequest<QuestionQueueResponse>(
        apiBase,
        `/v1/interview/sessions/${sessionId}/questions`,
        { auth: "required" },
      );

      const items = data.items || [];
      const fallbackQuestion =
        data.current_question ||
        items.find((item) => item.status !== "answered" && item.status !== "skipped") ||
        null;

      setQueueItems(items);
      setCurrentQuestionId((previousId) => {
        if (options?.preserveDisplayedQuestion && previousId) return previousId;
        return fallbackQuestion?.id || null;
      });
      if (options?.resetStageToIdle) {
        setStageStep("idle");
        setStageLabel(getInitialStageLabel(fallbackQuestion));
      }
      setOutput(
        JSON.stringify(
          {
            queue_count: items.length,
            current_question: data.current_question?.id || null,
          },
          null,
          2,
        ),
      );
    } catch (error) {
      setOutput(String(error));
    } finally {
      setQueueLoading(false);
    }
  }, [apiBase, sessionId]);

  const loadSessionDetail = useCallback(async () => {
    if (!sessionId) return;

    try {
      const data = await apiRequest<InterviewSessionDetail>(
        apiBase,
        `/v1/interview/sessions/${sessionId}`,
        { auth: "required" },
      );
      setSessionDetail(data);
      if (data.status === "completed") {
        setStageStep("completed");
        setStageLabel("本场面试已结束，请返回重新开始");
      }
    } catch (error) {
      setOutput(String(error));
    }
  }, [apiBase, sessionId]);

  const loadTurnHistory = useCallback(async () => {
    if (!sessionId) return;

    try {
      const data = await apiRequest<TurnHistoryResponse>(
        apiBase,
        `/v1/interview/sessions/${sessionId}/turns`,
        { auth: "required" },
      );
      const historyTurns = (data.items || []).map(normalizePersistedTurnRecord);
      setTurns(historyTurns);
      setConversationRows(buildConversationRowsFromTurns(historyTurns));
    } catch (error) {
      setOutput(String(error));
    } finally {
      setHistoryLoaded(true);
    }
  }, [apiBase, sessionId]);

  const advanceToNextQuestion = useCallback((nextQuestion?: InterviewQuestion | null) => {
    const targetQuestion = nextQuestion ?? pendingNextQuestion;
    if (!targetQuestion) return;

    clearAutoAdvanceTimer();
    setCurrentQuestionId(targetQuestion.id);
    setPendingNextQuestion(null);
    setQuestionCardMode("active");
    setStageStep("idle");
    setStageLabel("等待你的回答");
    setAnswer("");

    window.requestAnimationFrame(() => {
      questionViewportRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      transcriptScrollRef.current?.scrollTo({
        top: transcriptScrollRef.current.scrollHeight,
        behavior: "smooth",
      });
      composerRef.current?.focus({ preventScroll: true });
    });
  }, [clearAutoAdvanceTimer, pendingNextQuestion]);

  const scheduleAutoAdvance = useCallback((nextQuestion: InterviewQuestion) => {
    clearAutoAdvanceTimer();
    autoAdvanceTimerRef.current = window.setTimeout(() => {
      advanceToNextQuestion(nextQuestion);
    }, 5000);
  }, [advanceToNextQuestion, clearAutoAdvanceTimer]);

  useEffect(() => {
    if (sessionClosed) return;
    let timer: number | undefined;
    const tick = () => setNow(Date.now());
    const startTimer = () => {
      if (!timer) timer = window.setInterval(tick, 1000);
    };
    const stopTimer = () => {
      if (timer) { window.clearInterval(timer); timer = undefined; }
    };
    const onVisibilityChange = () => {
      if (document.hidden) {
        hiddenAtRef.current = Date.now();
        stopTimer();
      } else {
        if (hiddenAtRef.current !== null) {
          pausedMsRef.current += Date.now() - hiddenAtRef.current;
          hiddenAtRef.current = null;
        }
        tick();
        startTimer();
      }
    };
    startTimer();
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      stopTimer();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [sessionClosed]);

  useEffect(() => {
    return () => {
      clearAutoAdvanceTimer();
    };
  }, [clearAutoAdvanceTimer]);

  useEffect(() => {
    if (!sessionId) return;

    setHistoryLoaded(false);
    restoredHistoryRef.current = false;
    if (typeof window !== "undefined") {
      const cachedHistory = window.sessionStorage.getItem(getHistoryStorageKey(sessionId));
      if (cachedHistory) {
        try {
          const parsed = JSON.parse(cachedHistory) as {
            turns?: InterviewTurnHistoryItem[];
            conversationRows?: ConversationRow[];
          };
          if (isPersistedTurnList(parsed.turns)) {
            const restoredTurns = parsed.turns.map(normalizePersistedTurnRecord);
            setTurns(restoredTurns);
            if (!isConversationRowList(parsed.conversationRows)) {
              setConversationRows(buildConversationRowsFromTurns(restoredTurns));
            }
            restoredHistoryRef.current = true;
          }
          if (isConversationRowList(parsed.conversationRows)) {
            setConversationRows(parsed.conversationRows);
            restoredHistoryRef.current = true;
          }
        } catch {
          window.sessionStorage.removeItem(getHistoryStorageKey(sessionId));
        }
      }
    }

    void loadSessionDetail();
    void loadQuestionQueue({ resetStageToIdle: true });
    if (!restoredHistoryRef.current) {
      void loadTurnHistory();
      return;
    }
    setHistoryLoaded(true);
  }, [loadQuestionQueue, loadSessionDetail, loadTurnHistory, sessionId]);

  useEffect(() => {
    if (!sessionId || !historyLoaded || typeof window === "undefined") return;

    const persistedTurns: InterviewTurnHistoryItem[] = turns.map((turn) => ({
      id: turn.turn_id || `turn-${turn.turn_index}`,
      session_id: turn.session_id,
      question_id: turn.question_id || null,
      turn_index: turn.turn_index,
      question: turn.question,
      answer: turn.answer,
      score: turn.score ?? 0,
      strengths: turn.strengths || [],
      weaknesses: turn.weaknesses || [],
      evidence_refs_count: turn.evidence_refs_count ?? 0,
      created_at: "",
    }));

    window.sessionStorage.setItem(
      getHistoryStorageKey(sessionId),
      JSON.stringify({
        turns: persistedTurns,
        conversationRows,
      }),
    );
  }, [conversationRows, historyLoaded, sessionId, turns]);

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [conversationRows]);

  useEffect(() => {
    if (!isPanelOpen) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsPanelOpen(false);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isPanelOpen]);

  const onAddTurn = async () => {
    if (!sessionId || !currentQuestion || !answer.trim()) return;
    if (sessionClosed) {
      setStageStep("completed");
      setStageLabel("本场面试已结束，请返回重新开始");
      setConversationRows((previousRows) => [
        ...previousRows,
        {
          id: `notice-${Date.now()}`,
          role: "assistant",
          kind: "notice",
          content: "系统提示：本场面试已经结束，当前会话不再接收新的回答，请返回面试准备页重新开始。",
        },
      ]);
      return;
    }

    try {
      setSubmittingTurn(true);
      setShowCompletionReport(false);
      setQuestionCardMode("active");
      setStageStep("receiving");
      setStageLabel("正在接收回答");
      clearAutoAdvanceTimer();

      const submittedAnswer = answer.trim();
      const requestPayload = {
        question_id: currentQuestion.id,
        question: currentQuestion.stem,
        answer: submittedAnswer,
        evidence_refs: [],
      };
      const evaluationId = `evaluation-pending-${Date.now()}`;

      setConversationRows((previousRows) => [
        ...previousRows,
        { id: `answer-${Date.now()}`, role: "user", kind: "answer", content: submittedAnswer },
        { id: evaluationId, role: "assistant", kind: "evaluation", content: "正在接收回答..." },
      ]);
      setAnswer("");

      const token = await getToken();
      const response = await fetch(`${apiBase}/v1/interview/sessions/${sessionId}/turns/stream`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(requestPayload),
        cache: "no-store",
      });

      if (!response.ok || !response.body) {
        const errorData = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
        throw new Error((errorData as { error?: string }).error || `HTTP ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder("utf-8");
      let buffer = "";
      let finalData: TurnResponse | null = null;
      let finalTurnRecord: TurnRecord | null = null;
      let streamFailed = false;
      let streamingText = "";

      const handleEvent = (eventName: string, payloadText: string) => {
        const payload = payloadText
          ? (JSON.parse(payloadText) as TurnResponse | InterviewTurnStageEvent | { error?: string })
          : {};

        if (eventName === "stage") {
          const stage = getStageDisplay(payload as InterviewTurnStageEvent);
          setStageStep(stage.step);
          setStageLabel(stage.label);
          return;
        }

        if (eventName === "token") {
          const token = payload as InterviewTurnTokenEvent;
          if (!token.textChunk) return;

          streamingText += token.textChunk;
          updateEvaluationRow(evaluationId, streamingText);
          return;
        }

        if (eventName === "result") {
          finalData = payload as TurnResponse;
          finalTurnRecord = normalizeTurnRecord(finalData, currentQuestion.stem, submittedAnswer);
          updateEvaluationRow(
            evaluationId,
            finalData.evaluation_text ||
              finalData.reply_text ||
              "当前 LLM 服务不可用，未能生成评价文本。",
          );
          if (finalData.handled_as === "answer") {
            setTurns((previousTurns) => [...previousTurns, finalTurnRecord!]);
          }
          return;
        }

        if (eventName === "error") {
          throw new Error((payload as { error?: string }).error || "stream failed");
        }
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const chunks = buffer.split(/\r?\n\r?\n/g);
        buffer = chunks.pop() || "";

        for (const chunk of chunks) {
          const lines = chunk.split("\n");
          const eventLine = lines.find((line) => line.startsWith("event:"));
          const dataLines = lines.filter((line) => line.startsWith("data:"));
          const eventName = eventLine ? eventLine.slice(6).trim() : "message";
          const payloadText = dataLines.map((line) => line.slice(5).trim()).join("\n");
          handleEvent(eventName, payloadText);
        }
      }

      if (!finalData) {
        streamFailed = true;
      }

      if (streamFailed || !finalData) {
        throw new Error("interview turn stream ended without result");
      }

      const data = finalData as TurnResponse;
      const reconciledItems = reconcileQueueItems(queueItems, currentQuestion, data);
      setQueueItems(reconciledItems);
      setOutput(JSON.stringify(data, null, 2));

      if (data.next_question) {
        setPendingNextQuestion(data.next_question);
        setQuestionCardMode("transition");
        setStageStep("transition");
        setStageLabel("下一题已准备好");
        scheduleAutoAdvance(data.next_question);
        await loadQuestionQueue({ preserveDisplayedQuestion: true });
        return;
      }

      clearAutoAdvanceTimer();
      setPendingNextQuestion(null);
      setCurrentQuestionId(null);

      const completed = reconciledItems.every(
        (item) => item.status === "answered" || item.status === "skipped",
      );

      if (completed) {
        setQuestionCardMode("completed");
        setStageStep("completed");
        setStageLabel("本场面试已完成");
        setShowCompletionReport(true);
      } else {
        setQuestionCardMode("active");
        await loadQuestionQueue({ resetStageToIdle: true });
      }
    } catch (error) {
      const message = String(error);
      setStageStep("idle");
      setStageLabel("处理失败，请稍后重试");
      setOutput(message);
      setConversationRows((previousRows) => [
        ...previousRows,
        { id: `notice-${Date.now()}`, role: "assistant", kind: "notice", content: `系统提示：${message}` },
      ]);
    } finally {
      setSubmittingTurn(false);
    }
  };

  const onFinish = async () => {
    try {
      setFinishing(true);
      const data = await apiRequest<Record<string, unknown>>(
        apiBase,
        `/v1/interview/sessions/${sessionId}/finish`,
        {
          method: "POST",
          body: JSON.stringify({ summary: "web done" }),
          auth: "required",
        },
      );
      setOutput(JSON.stringify(data, null, 2));
    } catch (error) {
      setOutput(String(error));
    } finally {
      setFinishing(false);
    }
  };

  const onRetrospect = async () => {
    try {
      setRetrospecting(true);
      const data = await apiRequest<RetrospectResponse>(
        apiBase,
        `/v1/interview/sessions/${sessionId}/retrospect`,
        {
          method: "POST",
          body: JSON.stringify({ chapter: "综合面试" }),
          auth: "required",
        },
      );
      setRetrospect(data);
      setOutput(JSON.stringify(data, null, 2));
    } catch (error) {
      setOutput(String(error));
    } finally {
      setRetrospecting(false);
    }
  };

  if (!sessionId) {
    return (
      <section className="p-6">
        <div className="mx-auto max-w-3xl rounded-3xl border border-border bg-card p-8 text-center">
          <p className="text-sm text-muted-foreground">缺少会话参数，请从模拟面试入口重新开始。</p>
          <Link
            href="/interview"
            className="mt-4 inline-flex rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
          >
            返回面试准备页
          </Link>
        </div>
      </section>
    );
  }

  if (isLoaded && !isSignedIn) {
    return (
      <section className="p-6">
        <div className="mx-auto max-w-3xl rounded-3xl border border-border bg-card p-8 text-center">
          <p className="text-sm text-muted-foreground">当前会话需要登录后访问，请先返回面试准备页完成登录。</p>
          <Link
            href="/interview"
            className="mt-4 inline-flex rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
          >
            返回面试准备页
          </Link>
        </div>
      </section>
    );
  }

  return (
    <section className="flex h-dvh flex-col overflow-hidden px-3 py-3 md:px-4 md:py-4">
      <div className="mx-auto flex min-h-0 w-full max-w-7xl flex-1 flex-col gap-3">
        <SessionTopBar
          answeredCount={answeredCount}
          totalCount={queueItems.length}
          currentQuestion={currentQuestion ?? pendingNextQuestion}
          elapsedLabel={formatElapsed(elapsedMs)}
          interviewCompleted={interviewCompleted}
          sessionClosed={sessionClosed}
          stageLabel={stageLabel}
          stageStep={stageStep}
          endedNotice={sessionClosed ? "本场面试已经结束，请返回重新开始" : stageLabel}
          onOpenPanel={() => {
            setPanelTab("progress");
            setIsPanelOpen(true);
          }}
        />

        <InterviewPanelDrawer
          isOpen={isPanelOpen}
          panelTab={panelTab}
          onClose={() => setIsPanelOpen(false)}
          onTabChange={setPanelTab}
          answeredCount={answeredCount}
          totalCount={queueItems.length}
          averageScore={averageScore}
          latestTurn={latestTurn}
          stageLabel={stageLabel}
          queueItems={queueItems}
          currentQuestionId={currentQuestionId}
          pendingNextQuestionId={pendingNextQuestion?.id || null}
          retrospect={retrospect}
          queueLoading={queueLoading}
          retrospecting={retrospecting}
          finishing={finishing}
          canRetrospect={turns.length > 0}
          onRefresh={() => {
            void loadQuestionQueue({
              preserveDisplayedQuestion: questionCardMode === "transition",
              resetStageToIdle: questionCardMode !== "transition" && !showCompletionReport,
            });
          }}
          onRetrospect={() => {
            void onRetrospect();
          }}
          onFinish={() => {
            void onFinish();
          }}
          debugOutput={process.env.NODE_ENV === "development" ? output : undefined}
        />

        {showCompletionReport ? (
          <section className="flex min-h-0 flex-1 items-center justify-center overflow-auto rounded-2xl border border-border/70 bg-card/92 p-5 shadow-[var(--shadow-soft)]">
            <InterviewCompletionReport
              answeredCount={answeredCount}
              averageScore={averageScore}
              latestTurn={latestTurn}
              retrospect={retrospect}
              retrospecting={retrospecting}
              finishing={finishing}
              onRetrospect={() => {
                void onRetrospect();
              }}
              onFinish={() => {
                void onFinish();
              }}
            />
          </section>
        ) : (
          <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-border/70 bg-card/92 shadow-[var(--shadow-soft)]">
            <div className="shrink-0 bg-background/72 px-4 py-3 md:px-6">
              <div ref={questionViewportRef} className="mx-auto space-y-0">
                <CurrentQuestionCard
                  currentQuestion={currentQuestion}
                  pendingNextQuestion={pendingNextQuestion}
                  questionCardMode={questionCardMode}
                  onAdvance={advanceToNextQuestion}
                />
                <StageStatusBar stageLabel={stageLabel} stageStep={stageStep} />
              </div>
            </div>

            <ConversationTranscript
              conversationRows={conversationRows}
              scrollContainerRef={transcriptScrollRef}
              transcriptEndRef={transcriptEndRef}
            />

            <Composer
              answer={answer}
              currentQuestion={currentQuestion}
              interviewCompleted={interviewCompleted}
              sessionClosed={sessionClosed}
              questionCardMode={questionCardMode}
              submittingTurn={submittingTurn}
              composerRef={composerRef}
              onAnswerChange={setAnswer}
              onSubmit={() => {
                void onAddTurn();
              }}
            />
          </section>
        )}
      </div>
    </section>
  );
}
