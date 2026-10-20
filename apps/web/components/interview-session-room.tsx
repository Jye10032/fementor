"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiRequest } from "../lib/api";
import { useAuthState } from "./auth-provider";
import { Composer } from "./interview-session/Composer";
import { ConversationTranscript } from "./interview-session/ConversationTranscript";
import { CurrentQuestionCard } from "./interview-session/CurrentQuestionCard";
import { InterviewCompletionReport } from "./interview-session/InterviewCompletionReport";
import { EvidenceEvaluation } from "./interview-session/EvidenceEvaluation";
import { InterviewPanelDrawer } from "./interview-session/InterviewPanelDrawer";
import {
  buildConversationRowsFromTurns,
  formatElapsed,
  getStageDisplay,
  normalizePersistedTurnRecord,
  normalizeTurnRecord,
  restoreServerHistory,
  mergeHistoryRows,
  reconcileQueueItems,
} from "./interview-session/copy";
import { SessionTopBar } from "./interview-session/SessionTopBar";
import { StageStatusBar } from "./interview-session/StageStatusBar";
import { useInterviewSubmission } from "./interview-session/useInterviewSubmission";
import {
  ConversationRow,
  InterviewQuestion,
  InterviewSessionDetail,
  InterviewTurnHistoryItem,
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
  const { apiBase, agentRuntimeId } = useRuntimeConfig();
  const { getToken, isLoaded, isSignedIn, authReady } = useAuthState();
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
  const [lastDecision, setLastDecision] = useState<TurnResponse["agent_decision"]>();
  const [finishing, setFinishing] = useState(false);
  const [hasClosedSession, setHasClosedSession] = useState(false);
  const [retrospecting, setRetrospecting] = useState(false);
  const [startedAt] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  const pausedMsRef = useRef(0);
  const hiddenAtRef = useRef<number | null>(null);
  const questionViewportRef = useRef<HTMLDivElement>(null);
  const transcriptScrollRef = useRef<HTMLDivElement>(null);
  const transcriptEndRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const restoredHistoryRef = useRef(false);
  const closedSessionRef = useRef(false);
  const historyRequestRef = useRef(0);

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
    if (showCompletionReport || sessionDetail?.status === "completed") return true;
    if (queueItems.length === 0) return false;
    return (
      queueItems.every((item) => item.status === "answered" || item.status === "skipped") &&
      !currentQuestion &&
      !pendingNextQuestion
    );
  }, [currentQuestion, pendingNextQuestion, queueItems, showCompletionReport, sessionDetail?.status]);
  const sessionClosed = hasClosedSession || sessionDetail?.status === "completed";
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

  const markSessionCompleted = useCallback((endedAt?: string | null) => {
    // Completion is irreversible for this mounted session, including across late GET responses.
    closedSessionRef.current = true;
    setHasClosedSession(true);
    setAnswer("");
    setSessionDetail((previous) => previous ? {
      ...previous, status: "completed", ended_at: endedAt || previous.ended_at,
    } : previous);
    setCurrentQuestionId(null);
    setPendingNextQuestion(null);
    setShowCompletionReport(true);
    setQuestionCardMode("completed");
    setStageStep("completed");
    setStageLabel("本场面试已结束");
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
        { auth: "required", signal: AbortSignal.timeout(15000) },
      );

      if (closedSessionRef.current && data.session_status !== "completed") return;
      const items = data.items || [];
      const fallbackQuestion = data.session_status === "completed" ? null : (
        data.current_question ||
        items.find((item) => item.status === "asked" || item.status === "pending") ||
        null);

      setQueueItems(items);
      setCurrentQuestionId((previousId) => {
        if (data.session_status === "completed") return null;
        if (options?.preserveDisplayedQuestion && previousId) return previousId;
        return fallbackQuestion?.id || null;
      });
      if (data.session_status === "completed") {
        markSessionCompleted();
      } else if (options?.resetStageToIdle) {
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
  }, [apiBase, sessionId, markSessionCompleted]);

  const loadSessionDetail = useCallback(async () => {
    if (!sessionId) return;

    try {
      const data = await apiRequest<InterviewSessionDetail>(
        apiBase,
        `/v1/interview/sessions/${sessionId}`,
        { auth: "required", signal: AbortSignal.timeout(15000) },
      );
      if (closedSessionRef.current && data.status !== "completed") return;
      setSessionDetail(data);
      if (data.status === "completed") {
        markSessionCompleted(data.ended_at);
      }
    } catch (error) {
      setOutput(String(error));
    }
  }, [apiBase, sessionId, markSessionCompleted]);

  const loadTurnHistory = useCallback(async (required = false) => {
    if (!sessionId) return;
    const requestId = ++historyRequestRef.current;
    try {
      const data = await apiRequest<TurnHistoryResponse>(
        apiBase,
        `/v1/interview/sessions/${sessionId}/turns`,
        { auth: "required", signal: AbortSignal.timeout(15000) },
      );
      if (requestId !== historyRequestRef.current) return;
      const history = restoreServerHistory(data);
      setTurns(history.turns);
      setLastDecision(data.submissions?.at(-1)?.result.agent_decision);
      setConversationRows((previous) => mergeHistoryRows(previous, history.events));
    } catch (error) {
      setOutput(String(error));
      if (required) throw error;
    } finally {
      if (requestId === historyRequestRef.current) setHistoryLoaded(true);
    }
  }, [apiBase, sessionId]);

  useEffect(() => {
    // Read again after observing completion, even if the initial parallel
    // history request took its snapshot before the final commit.
    if (sessionClosed) void loadTurnHistory();
  }, [sessionClosed, loadTurnHistory]);

  const advanceToNextQuestion = useCallback((nextQuestion?: InterviewQuestion | null) => {
    if (closedSessionRef.current) return;
    const targetQuestion = nextQuestion ?? pendingNextQuestion;
    if (!targetQuestion) return;

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
  }, [pendingNextQuestion]);

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
    if (!sessionId || !isLoaded || !isSignedIn || !authReady) return;

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
    // Cached rows are only the first paint; server commits may have completed
    // while the response connection was lost.
    void loadTurnHistory();
  }, [loadQuestionQueue, loadSessionDetail, loadTurnHistory, sessionId, isLoaded, isSignedIn, authReady]);

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

  const submission = useInterviewSubmission({
    apiBase, sessionId,
    ready: isLoaded && isSignedIn && historyLoaded && Boolean(currentQuestion) && agentRuntimeId !== "unknown",
    closed: sessionClosed,
    durable: agentRuntimeId === "codex",
    currentQuestion, getToken,
    onRestore: (pending) => {
      setAnswer((previous) => previous || pending.answer);
    },
    onStart: (pending) => {
      setShowCompletionReport(false);
      setQuestionCardMode("active");
      setStageStep("receiving");
      setStageLabel("正在接收回答");
      const evaluationId = `submission-evaluation-${pending.id}`;
      const answerId = `submission-answer-${pending.id}`;
      setConversationRows((previous) => [
        ...previous.filter((row) => row.id !== answerId && row.id !== evaluationId),
        { id: answerId, role: "user", kind: "answer", content: pending.answer },
        { id: evaluationId, role: "assistant", kind: "reply", content: "正在接收回答..." },
      ]);
    },
    onStage: (event) => {
      if (closedSessionRef.current) return;
      const display = getStageDisplay(event);
      setStageStep(display.step);
      setStageLabel(display.label);
    },
    onToken: (id, text) => updateEvaluationRow(`submission-evaluation-${id}`, text),
    onProblem: (id, message) => {
      if (closedSessionRef.current) return;
      setStageStep("idle");
      setStageLabel(message);
      setConversationRows((previous) => previous.map((row) => row.id === `submission-evaluation-${id}`
        ? { ...row, kind: "notice", content: message } : row));
    },
    onResult: async (data, pending, recovered) => {
      setAnswer("");
      setLastDecision(data.agent_decision);
      if (recovered) {
        await loadTurnHistory(true);
        const queue = await apiRequest<QuestionQueueResponse>(
          apiBase, `/v1/interview/sessions/${sessionId}/questions`, { auth: "required", signal: AbortSignal.timeout(15000) },
        );
        if (closedSessionRef.current && queue.session_status !== "completed") return;
        setQueueItems(queue.items);
        if (queue.session_status === "completed") {
          markSessionCompleted(data.ended_at);
        } else if (data.handled_as !== "non_answer" && data.agent_decision?.action !== "clarify"
          && data.next_question && data.next_question.id !== pending.question_id && queue.current_question?.id === data.next_question.id
          && queue.items.some((question) => question.id === pending.question_id)) {
          setCurrentQuestionId(pending.question_id);
          setPendingNextQuestion(queue.current_question);
          setQuestionCardMode("transition");
          setStageStep("transition");
          setStageLabel("已恢复本轮反馈，准备好后继续");
        } else {
          setCurrentQuestionId(queue.current_question?.id || null);
          setPendingNextQuestion(null);
          setQuestionCardMode("active");
          setStageStep("idle");
          setStageLabel("已恢复面试进度，可以继续回答");
        }
        await loadSessionDetail();
        return;
      }
      const record = normalizeTurnRecord(data, pending.question, pending.answer);
      setConversationRows((previous) => previous.map((row) => row.id === `submission-evaluation-${pending.id}`
        ? { ...row, kind: data.handled_as === "answer" ? "evaluation" : "reply", decision: data.agent_decision,
          content: data.evaluation_text || data.reply_text || "本轮处理已完成。" } : row));
      if (data.handled_as === "answer") setTurns((previous) => [...previous.filter((turn) => turn.turn_id !== record.turn_id), record]);
      if (closedSessionRef.current && data.session_status !== "completed") return;
      const answeredQuestion = queueItems.find((question) => question.id === pending.question_id);
      if (!answeredQuestion) { await loadQuestionQueue(); return; }
      const items = reconcileQueueItems(queueItems, answeredQuestion, data);
      setCurrentQuestionId(answeredQuestion.id);
      setQueueItems(items);
      setOutput(JSON.stringify(data, null, 2));
      if (data.session_status === "completed") {
        markSessionCompleted(data.ended_at);
        await loadSessionDetail();
      } else if (data.agent_decision?.action === "clarify" || data.handled_as === "non_answer") {
        setPendingNextQuestion(null);
        setQuestionCardMode("active");
        setStageStep("idle");
        setStageLabel("面试官已回复，请继续回答当前题目");
      } else if (data.next_question) {
        setPendingNextQuestion(data.next_question);
        setQuestionCardMode("transition");
        setStageStep("transition");
        setStageLabel("本轮反馈已完成，准备好后继续");
        await loadQuestionQueue({ preserveDisplayedQuestion: true });
      } else {
        setCurrentQuestionId(null);
        setPendingNextQuestion(null);
        if (items.every((item) => item.status === "answered" || item.status === "skipped")) {
          setQuestionCardMode("completed");
          setStageStep("completed");
          setStageLabel("本场题目已完成");
          setShowCompletionReport(true);
        } else await loadQuestionQueue({ resetStageToIdle: true });
      }
    },
  });

  const onFinish = async () => {
    if (closedSessionRef.current || finishing || submission.busy || submission.status === "unavailable") return;
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
      markSessionCompleted(typeof data.ended_at === "string" ? data.ended_at : null);
      setOutput(JSON.stringify(data, null, 2));
      await loadSessionDetail();
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
          stageLabel={submission.message || stageLabel}
          stageStep={stageStep}
          endedNotice={sessionClosed ? "本场面试已经结束，请返回重新开始" : null}
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
          sessionClosed={sessionClosed}
          turnBusy={submission.busy || submission.status === "unavailable"}
          canRetrospect={turns.length > 0}
          onRefresh={() => {
            void loadQuestionQueue({
              preserveDisplayedQuestion: questionCardMode === "transition" || submission.busy,
              resetStageToIdle: questionCardMode !== "transition" && !showCompletionReport && !submission.busy,
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

        {latestTurn?.turn_id && <EvidenceEvaluation key={latestTurn.turn_id} apiBase={apiBase} sessionId={sessionId} turnId={latestTurn.turn_id} />}

        {showCompletionReport ? (
          <section className="flex min-h-0 flex-1 items-center justify-center overflow-auto rounded-2xl border border-border/70 bg-card/92 p-5 shadow-[var(--shadow-soft)]">
            <InterviewCompletionReport
              sessionClosed={sessionClosed}
              decisionReason={lastDecision?.reason}
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
                  disabled={submission.busy}
                  onAdvance={() => {
                    if (submission.busy) return;
                    submission.resetActivity(); advanceToNextQuestion();
                  }}
                />
                <StageStatusBar stageLabel={stageLabel} busy={submission.busy}
                  saved={submission.saved} elapsedMs={submission.elapsedMs} steps={submission.steps}
                  message={submission.message} canRefresh={submission.status === "unavailable"}
                  onRefresh={submission.refresh} />
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
              submittingTurn={submission.busy}
              locked={!submission.ready || submission.status === "unavailable" || finishing}
              retryable={submission.status === "retryable"}
              canStop={submission.canStop}
              onStop={submission.stop}
              composerRef={composerRef}
              onAnswerChange={setAnswer}
              onSubmit={() => {
                void submission.submit(answer);
              }}
            />
          </section>
        )}
      </div>
    </section>
  );
}
