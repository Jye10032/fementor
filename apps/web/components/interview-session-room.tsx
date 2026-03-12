"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  CircleCheckBig,
  Clock3,
  FileSearch,
  RefreshCw,
  Send,
  Target,
  Trophy,
} from "lucide-react";
import { useRuntimeConfig } from "./runtime-config";
import { apiRequest } from "../lib/api";

type TurnResponse = {
  session_id: string;
  question_id?: string | null;
  turn_id: string;
  turn_index: number;
  score: number;
  strengths: string[];
  weaknesses: string[];
  feedback?: string;
  standard_answer?: string;
  retrieval_strategy?: string;
  evidence_refs_count: number;
  next_question?: InterviewQuestion | null;
};

type RetrospectResponse = {
  session_id: string;
  chapter: string;
  avg_score: number;
  turns_count: number;
  promoted_questions: number;
  promoted_new_questions: number;
  promoted_updated_questions: number;
  memory_path?: string;
  long_term_memory?: {
    stable_strengths: string[];
    stable_weaknesses: string[];
    project_signals: string[];
    role_fit_signals: string[];
    recommended_focus: string[];
  };
};

type TurnRecord = TurnResponse & { question: string; answer: string };
type ConversationRow = {
  id: string;
  role: "user" | "assistant";
  kind: "question" | "answer" | "evaluation" | "notice";
  content: string;
};
type InterviewQuestion = {
  id: string;
  session_id: string;
  order_no: number;
  source: "resume" | "doc" | "llm";
  question_type: "basic" | "project" | "scenario" | "follow_up";
  difficulty: "easy" | "medium" | "hard";
  stem: string;
  status: "pending" | "asked" | "answered" | "skipped";
};
type QuestionQueueResponse = {
  session_id: string;
  items: InterviewQuestion[];
  current_question: InterviewQuestion | null;
};
type Props = {
  initialSessionId: string;
};

type InterviewTurnStageEvent = {
  step: string;
  message: string;
};

function formatElapsed(ms: number) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, "0");
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function buildEvaluationNarration(turn: TurnRecord) {
  return [
    `本轮得分 ${turn.score} 分。`,
    turn.feedback ? `总体评价：${turn.feedback}` : "",
    turn.strengths.length > 0 ? `做得较好的点：${turn.strengths.join("，")}。` : "",
    turn.weaknesses.length > 0 ? `接下来优先补强：${turn.weaknesses.join("，")}。` : "",
    turn.standard_answer ? `参考标准答案：${turn.standard_answer}` : "",
    `本轮命中 ${turn.evidence_refs_count} 条资料证据${turn.retrieval_strategy ? `，检索策略为 ${turn.retrieval_strategy}` : ""}。`,
  ]
    .filter(Boolean)
    .join("\n");
}

function getConversationLabel(row: ConversationRow) {
  if (row.kind === "question") return "AI 面试官";
  if (row.kind === "evaluation") return "AI 评价";
  if (row.kind === "notice") return "系统提示";
  return "你";
}

const questionTypeLabel: Record<InterviewQuestion["question_type"], string> = {
  basic: "基础题",
  project: "项目题",
  scenario: "场景题",
  follow_up: "追问题",
};

export function InterviewSessionRoom({ initialSessionId }: Props) {
  const { apiBase, userId } = useRuntimeConfig();
  const [sessionId] = useState(initialSessionId);
  const [answer, setAnswer] = useState("");
  const [turns, setTurns] = useState<TurnRecord[]>([]);
  const [conversationRows, setConversationRows] = useState<ConversationRow[]>([]);
  const [queueItems, setQueueItems] = useState<InterviewQuestion[]>([]);
  const [currentQuestionId, setCurrentQuestionId] = useState<string | null>(null);
  const [retrospect, setRetrospect] = useState<RetrospectResponse | null>(null);
  const [output, setOutput] = useState("");
  const [queueLoading, setQueueLoading] = useState(false);
  const [submittingTurn, setSubmittingTurn] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [retrospecting, setRetrospecting] = useState(false);
  const [recentInsertedQuestionId, setRecentInsertedQuestionId] = useState<string | null>(null);
  const [startedAt] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  const askedQuestionIdsRef = useRef<Set<string>>(new Set());
  const transcriptEndRef = useRef<HTMLDivElement | null>(null);
  const endedNoticeRef = useRef(false);
  const insertedQuestionTimerRef = useRef<number | null>(null);

  const currentQuestion = useMemo(
    () => queueItems.find((item) => item.id === currentQuestionId) ?? null,
    [queueItems, currentQuestionId],
  );
  const latestTurn = useMemo(() => turns[turns.length - 1] ?? null, [turns]);
  const averageScore = useMemo(() => {
    if (turns.length === 0) return null;
    return Math.round(turns.reduce((sum, turn) => sum + turn.score, 0) / turns.length);
  }, [turns]);
  const answeredCount = useMemo(() => queueItems.filter((item) => item.status === "answered").length, [queueItems]);
  const interviewCompleted = useMemo(
    () => queueItems.length > 0 && answeredCount === queueItems.length && !currentQuestion,
    [queueItems.length, answeredCount, currentQuestion],
  );

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => () => {
    if (insertedQuestionTimerRef.current) window.clearTimeout(insertedQuestionTimerRef.current);
  }, []);

  const loadQuestionQueue = async () => {
    if (!sessionId) return;
    try {
      setQueueLoading(true);
      const data = await apiRequest<QuestionQueueResponse>(apiBase, `/v1/interview/sessions/${sessionId}/questions`);
      setQueueItems(data.items || []);
      setCurrentQuestionId(data.current_question?.id || data.items.find((item) => item.status !== "answered")?.id || null);
      setOutput(JSON.stringify({ queue_count: data.items.length, current_question: data.current_question?.id || null }, null, 2));
    } catch (error) {
      setOutput(String(error));
    } finally {
      setQueueLoading(false);
    }
  };

  useEffect(() => {
    void loadQuestionQueue();
  }, [sessionId]);

  useEffect(() => {
    if (!currentQuestion || askedQuestionIdsRef.current.has(currentQuestion.id)) return;
    askedQuestionIdsRef.current.add(currentQuestion.id);
    setConversationRows((prev) => [
      ...prev,
      {
        id: `question-${currentQuestion.id}`,
        role: "assistant",
        kind: "question",
        content: currentQuestion.stem,
      },
    ]);
  }, [currentQuestion]);

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [conversationRows]);

  useEffect(() => {
    if (!interviewCompleted || endedNoticeRef.current) return;
    endedNoticeRef.current = true;
    setConversationRows((prev) => [
      ...prev,
      {
        id: "interview-ended",
        role: "assistant",
        kind: "notice",
        content: "本场题目已经全部完成。你现在可以生成复盘，或者直接结束本场面试。",
      },
    ]);
  }, [interviewCompleted]);

  const updateEvaluationRow = (evaluationId: string, content: string) => {
    setConversationRows((prev) => prev.map((row) => (row.id === evaluationId ? { ...row, content } : row)));
  };

  const onAddTurn = async () => {
    if (!sessionId || !currentQuestion || !answer.trim()) return;
    try {
      setSubmittingTurn(true);
      const submittedAnswer = answer.trim();
      const evaluationId = `evaluation-pending-${Date.now()}`;
      setConversationRows((prev) => [
        ...prev,
        { id: `answer-${Date.now()}`, role: "user", kind: "answer", content: submittedAnswer },
        { id: evaluationId, role: "assistant", kind: "evaluation", content: "正在准备评分..." },
      ]);
      setAnswer("");

      const res = await fetch(`${apiBase}/v1/interview/sessions/${sessionId}/turns/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question_id: currentQuestion.id,
          question: currentQuestion.stem,
          answer: submittedAnswer,
          evidence_refs: [],
        }),
        cache: "no-store",
      });
      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        throw new Error((data as { error?: string }).error || `HTTP ${res.status}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder("utf-8");
      let buffer = "";
      let finalData: TurnResponse | null = null;
      let finalTurnRecord: TurnRecord | null = null;

      const handleEvent = (eventName: string, payloadText: string) => {
        const payload = payloadText ? JSON.parse(payloadText) as TurnResponse | InterviewTurnStageEvent | { error?: string } : {};
        if (eventName === "stage") {
          const stage = payload as InterviewTurnStageEvent;
          updateEvaluationRow(evaluationId, stage.message || "正在处理中...");
          return;
        }
        if (eventName === "result") {
          finalData = payload as TurnResponse;
          finalTurnRecord = { ...finalData, question: currentQuestion.stem, answer: submittedAnswer };
          updateEvaluationRow(evaluationId, buildEvaluationNarration(finalTurnRecord));
          setTurns((prev) => [...prev, finalTurnRecord!]);
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
        const chunks = buffer.split("\n\n");
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
        throw new Error("评分流未返回结果");
      }

      const data: TurnResponse = finalData;
      const turnRecord: TurnRecord = finalTurnRecord || { ...data, question: currentQuestion.stem, answer: submittedAnswer };
      if (data.next_question?.question_type === "follow_up") {
        setRecentInsertedQuestionId(data.next_question.id);
        if (insertedQuestionTimerRef.current) {
          window.clearTimeout(insertedQuestionTimerRef.current);
        }
        insertedQuestionTimerRef.current = window.setTimeout(() => {
          setRecentInsertedQuestionId(null);
          insertedQuestionTimerRef.current = null;
        }, 3500);
        setConversationRows((prev) => [
          ...prev,
          { id: `notice-${turnRecord.turn_id}`, role: "assistant", kind: "notice", content: "检测到当前回答存在薄弱点，系统已插入 1 道追问并优先继续深挖。" },
        ]);
      }
      setQueueItems((prev) => {
        const insertedFollowUp = data.next_question?.question_type === "follow_up";
        const nextItems: InterviewQuestion[] = prev.map((item) =>
          item.id === currentQuestion.id
            ? { ...item, status: "answered" }
            : insertedFollowUp && item.order_no > currentQuestion.order_no
              ? { ...item, order_no: item.order_no + 1 }
            : data.next_question && item.id === data.next_question.id
              ? { ...item, ...data.next_question, status: data.next_question.status as InterviewQuestion["status"] }
              : item,
        );
        if (data.next_question && !nextItems.some((item) => item.id === data.next_question?.id)) {
          nextItems.push(data.next_question as InterviewQuestion);
        }
        return [...nextItems].sort((a, b) => a.order_no - b.order_no);
      });
      setCurrentQuestionId(data.next_question?.id || null);
      setOutput(JSON.stringify(data, null, 2));
      await loadQuestionQueue();
    } catch (error) {
      setOutput(String(error));
    } finally {
      setSubmittingTurn(false);
    }
  };

  const onFinish = async () => {
    try {
      setFinishing(true);
      const data = await apiRequest<Record<string, unknown>>(apiBase, `/v1/interview/sessions/${sessionId}/finish`, {
        method: "POST",
        body: JSON.stringify({ summary: "web done" }),
      });
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
      const data = await apiRequest<RetrospectResponse>(apiBase, `/v1/interview/sessions/${sessionId}/retrospect`, {
        method: "POST",
        body: JSON.stringify({ chapter: "综合面试" }),
      });
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
          <Link href="/interview" className="mt-4 inline-flex rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">
            返回面试准备页
          </Link>
        </div>
      </section>
    );
  }

  return (
    <section className="min-h-[calc(100vh-57px)] bg-[radial-gradient(circle_at_top,rgba(59,130,246,0.10),transparent_38%),linear-gradient(180deg,#f7f9fc_0%,#f3f5f8_100%)] p-4 md:p-6">
      <div className="mx-auto flex max-w-7xl flex-col gap-4">
        <section className="rounded-3xl border border-border bg-card/90 p-4 shadow-sm backdrop-blur xl:p-5">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex items-start gap-3">
              <Link href="/interview" className="mt-0.5 inline-flex h-10 w-10 items-center justify-center rounded-xl border border-border bg-background text-muted-foreground hover:bg-secondary hover:text-foreground">
                <ArrowLeft className="h-4 w-4" />
              </Link>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-xl font-semibold tracking-tight text-foreground">综合模拟面试</h1>
                  <span className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">基于简历与 JD</span>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">已完成 {answeredCount}/{queueItems.length} 题 · 当前用户 {userId}</p>
                <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
                  <span className="rounded-full bg-secondary px-3 py-1">
                    {interviewCompleted ? "本场已完成" : currentQuestion ? `当前第 ${currentQuestion.order_no} 题` : "等待下一题"}
                  </span>
                  {currentQuestion ? (
                    <>
                      <span className="rounded-full bg-secondary px-3 py-1">{questionTypeLabel[currentQuestion.question_type]}</span>
                      <span className="rounded-full bg-secondary px-3 py-1">{currentQuestion.difficulty}</span>
                      <span className="rounded-full bg-secondary px-3 py-1">source {currentQuestion.source}</span>
                    </>
                  ) : null}
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="inline-flex items-center gap-2 rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground">
                <Clock3 className="h-4 w-4 text-muted-foreground" />
                {formatElapsed(now - startedAt)}
              </div>
              <button onClick={loadQuestionQueue} disabled={queueLoading} className="rounded-xl border border-border bg-background px-4 py-2 text-sm font-medium text-foreground hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-60">
                {queueLoading ? "刷新中..." : "刷新队列"}
              </button>
              <button onClick={onRetrospect} disabled={retrospecting || turns.length === 0} className="rounded-xl border border-border bg-background px-4 py-2 text-sm font-medium text-foreground hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-60">
                {retrospecting ? "复盘中..." : "生成复盘"}
              </button>
              <button onClick={onFinish} disabled={finishing} className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-2 text-sm font-medium text-rose-600 hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-60">
                {finishing ? "结束中..." : "结束面试"}
              </button>
            </div>
          </div>
        </section>

        <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
          <div className="flex h-[calc(100vh-220px)] min-h-[620px] flex-col overflow-hidden rounded-3xl border border-border bg-card/90 shadow-sm">
            <div className="flex-1 overflow-y-auto px-5 py-5">
              <div className="mx-auto max-w-3xl space-y-4">
                {conversationRows.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-border bg-background p-5 text-sm text-muted-foreground">
                    面试开始后，AI 面试官的问题、你的回答、评分评价都会直接出现在这里。
                  </div>
                ) : null}

                {conversationRows.map((item) => (
                  <article key={item.id} className={item.role === "assistant" ? "flex justify-start" : "flex justify-end"}>
                    <div className={item.role === "assistant" ? "max-w-[78%] rounded-[22px] rounded-tl-md border border-border bg-background px-4 py-3" : "max-w-[78%] rounded-[22px] rounded-tr-md bg-primary px-4 py-3 text-primary-foreground"}>
                      <p className={item.role === "assistant" ? "text-[11px] text-muted-foreground" : "text-[11px] text-primary-foreground/80"}>
                        {getConversationLabel(item)}
                      </p>
                      <p className="mt-1 whitespace-pre-wrap text-sm leading-7">{item.content}</p>
                    </div>
                  </article>
                ))}
                <div ref={transcriptEndRef} />
              </div>
            </div>

            <div className="border-t border-border bg-card/95 px-4 py-4 md:px-5">
              <div className="mx-auto max-w-3xl space-y-3">
                {interviewCompleted ? (
                  <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-4 text-sm text-emerald-800">
                    本场面试题目已全部完成。建议先点击“生成复盘”，再结束面试。
                  </div>
                ) : null}
                <textarea
                  value={answer}
                  onChange={(event) => setAnswer(event.target.value)}
                  rows={4}
                  placeholder={currentQuestion ? "在这里输入你的回答，发送后会直接出现在上方对话中。" : interviewCompleted ? "本场题目已结束，可先复盘或结束面试。" : "当前没有待回答题目，可先复盘或结束面试。"}
                  className="w-full rounded-2xl border border-input bg-background px-4 py-3 text-sm leading-7 text-foreground"
                  disabled={!currentQuestion}
                />
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-xs text-muted-foreground">发送后会基于当前简历和资料检索证据，并把 AI 评价以流式方式写入对话。</p>
                  <button onClick={onAddTurn} disabled={submittingTurn || !currentQuestion || !answer.trim()} className="inline-flex items-center gap-2 rounded-2xl bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60">
                    {submittingTurn ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                    {submittingTurn ? "发送中..." : currentQuestion ? "发送回答" : "已无待答题目"}
                  </button>
                </div>
              </div>
            </div>
          </div>

          <aside className="space-y-4">
            <section className="rounded-3xl border border-border bg-card/90 p-5 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">题目队列</p>
              <div className="mt-4 space-y-3">
                {queueItems.map((item) => (
                  <div
                    key={item.id}
                    className={`rounded-2xl p-4 transition-all ${
                      item.id === recentInsertedQuestionId
                        ? "border border-amber-400 bg-amber-50 shadow-[0_0_0_3px_rgba(251,191,36,0.18)]"
                        : item.id === currentQuestionId
                          ? "border border-primary bg-primary/5"
                          : item.question_type === "follow_up"
                            ? "border border-amber-200 bg-amber-50/70"
                            : "bg-background"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-xs text-muted-foreground">
                          第 {item.order_no} 题 · {questionTypeLabel[item.question_type]}
                          {item.id === recentInsertedQuestionId ? (
                            <span className="ml-2 rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] text-amber-700">
                              新插入
                            </span>
                          ) : null}
                        </p>
                        <p className="mt-1 text-sm font-medium text-foreground">{item.stem}</p>
                      </div>
                      <span className="rounded-full bg-secondary px-2.5 py-1 text-[11px] text-muted-foreground">{item.status}</span>
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">{item.source} · {item.difficulty}</p>
                  </div>
                ))}
                {queueItems.length === 0 ? <p className="text-sm text-muted-foreground">当前还没有加载到题目队列。</p> : null}
              </div>
            </section>

            <section className="rounded-3xl border border-border bg-card/90 p-5 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">面试状态</p>
              <div className="mt-4 grid gap-3 sm:grid-cols-3 xl:grid-cols-1">
                {[
                  { icon: Target, label: "已答题数", value: String(answeredCount), hint: `总题数 ${queueItems.length}` },
                  { icon: Trophy, label: "平均得分", value: averageScore !== null ? String(averageScore) : "-", hint: "当前会话均分" },
                  { icon: FileSearch, label: "证据命中", value: latestTurn ? String(latestTurn.evidence_refs_count) : "0", hint: latestTurn?.retrieval_strategy || "等待评分" },
                ].map((item) => (
                  <div key={item.label} className="rounded-2xl bg-background p-4">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs text-muted-foreground">{item.label}</p>
                      <item.icon className="h-4 w-4 text-primary" />
                    </div>
                    <p className="mt-3 text-2xl font-semibold tracking-tight text-foreground">{item.value}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{item.hint}</p>
                  </div>
                ))}
              </div>
            </section>

            <section className="rounded-3xl border border-border bg-card/90 p-5 shadow-sm">
              <div className="flex items-center gap-2">
                <CircleCheckBig className="h-4 w-4 text-primary" />
                <p className="text-sm font-semibold text-foreground">复盘结果</p>
              </div>
              {retrospect ? (
                <div className="mt-4 space-y-3">
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-2">
                    <div className="rounded-2xl bg-background p-4">
                      <p className="text-xs text-muted-foreground">平均分</p>
                      <p className="mt-2 text-2xl font-semibold text-foreground">{retrospect.avg_score}</p>
                    </div>
                    <div className="rounded-2xl bg-background p-4">
                      <p className="text-xs text-muted-foreground">回流题目</p>
                      <p className="mt-2 text-2xl font-semibold text-foreground">{retrospect.promoted_questions}</p>
                    </div>
                  </div>
                  <div className="rounded-2xl bg-background p-4 text-sm text-muted-foreground">
                    共 {retrospect.turns_count} 轮，新增 {retrospect.promoted_new_questions} 道，更新 {retrospect.promoted_updated_questions} 道。
                  </div>
                  {retrospect.long_term_memory ? (
                    <div className="rounded-2xl bg-background p-4 text-sm text-muted-foreground space-y-2">
                      <p className="text-xs text-muted-foreground">长期记忆提炼</p>
                      {retrospect.long_term_memory.stable_strengths.length > 0 ? <p>稳定优势：{retrospect.long_term_memory.stable_strengths.join("；")}</p> : null}
                      {retrospect.long_term_memory.stable_weaknesses.length > 0 ? <p>稳定弱项：{retrospect.long_term_memory.stable_weaknesses.join("；")}</p> : null}
                      {retrospect.long_term_memory.recommended_focus.length > 0 ? <p>建议重点：{retrospect.long_term_memory.recommended_focus.join("；")}</p> : null}
                    </div>
                  ) : null}
                  {retrospect.memory_path ? <div className="rounded-2xl bg-background p-4 text-xs break-all text-muted-foreground">memory: {retrospect.memory_path}</div> : null}
                </div>
              ) : (
                <div className="mt-4 rounded-2xl bg-background p-4 text-sm text-muted-foreground">点击“生成复盘”后，这里展示本场面试沉淀结果。</div>
              )}
            </section>

            <details className="rounded-3xl border border-border bg-card/90 p-5 shadow-sm">
              <summary className="cursor-pointer text-sm font-semibold text-foreground">调试输出</summary>
              <pre className="mt-4 max-h-64 overflow-auto whitespace-pre-wrap rounded-2xl bg-background p-4 text-xs text-foreground">{output || `session: ${sessionId}\nuser: ${userId}`}</pre>
            </details>
          </aside>
        </section>
      </div>
    </section>
  );
}
