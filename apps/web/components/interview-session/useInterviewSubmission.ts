"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiRequest } from "../../lib/api";
import { InterviewQuestion, InterviewTurnStageEvent, TurnHistoryResponse, TurnResponse } from "./types";

type Submission = {
  id: string;
  question_id: string;
  question: string;
  answer: string;
  saved?: boolean;
};
type SavedSubmission = Submission & { status: "pending" | "running" | "retryable" };
type Status = "idle" | "sending" | "processing" | "checking" | "retryable" | "unavailable" | "completed";
export type ActivityStep = { label: string; at: number };
type Options = {
  apiBase: string;
  sessionId: string;
  ready: boolean;
  closed: boolean;
  durable: boolean;
  currentQuestion: InterviewQuestion | null;
  getToken: () => Promise<string | null>;
  onStart: (submission: Submission) => void;
  onRestore: (submission: Submission) => void;
  onStage: (event: InterviewTurnStageEvent) => void;
  onToken: (id: string, text: string) => void;
  onResult: (result: TurnResponse, submission: Submission, recovered: boolean) => Promise<void>;
  onProblem: (id: string, message: string) => void;
};

// A dropped stream is not evidence of cancellation. Reconcile the durable
// submission before allowing another attempt; its ID remains stable on retry.
export function useInterviewSubmission(options: Options) {
  const callbacks = useRef(options);
  callbacks.current = options;
  const [status, setStatus] = useState<Status>("idle");
  const [saved, setSaved] = useState(false);
  const [message, setMessage] = useState("");
  const [steps, setSteps] = useState<ActivityStep[]>([]);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const pending = useRef<Submission | null>(null);
  const request = useRef<AbortController | null>(null);
  const recovery = useRef<AbortController | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(false);
  const stopped = useRef(false);
  const recovering = useRef(false);
  const generation = useRef(0);
  const storageKey = `interview-pending:${options.sessionId}`;
  const busy = ["sending", "processing", "checking"].includes(status);

  const remember = useCallback((submission: Submission | null) => {
    pending.current = submission;
    try {
      if (submission) sessionStorage.setItem(storageKey, JSON.stringify(submission));
      else sessionStorage.removeItem(storageKey);
    } catch { /* Storage may be disabled; the server remains authoritative. */ }
  }, [storageKey]);

  const stage = useCallback((event: InterviewTurnStageEvent) => {
    callbacks.current.onStage(event);
    setSteps((previous) => previous.at(-1)?.label === event.message ? previous
      : [...previous.slice(-11), { label: event.message, at: Date.now() }]);
  }, []);

  const complete = useCallback(async (result: TurnResponse, submission: Submission, recovered: boolean) => {
    // Keep controls locked until page reconciliation finishes. A committed
    // answer must never become a fresh scoring attempt.
    const version = generation.current;
    const live = () => mounted.current && version === generation.current && !callbacks.current.closed;
    setSaved(Boolean(result.submission_id || submission.saved));
    setStatus("checking");
    setMessage("本轮已完成，正在同步面试进度");
    setStartedAt(null);
    try {
      await callbacks.current.onResult(result, submission, recovered);
      if (!live()) return;
      remember(null);
      setStatus("completed");
      setMessage("");
    } catch {
      if (!live()) return;
      // Rendering reconciliation failed after a confirmed commit. Preserve the
      // same ID for a read-only status refresh, never offer a fresh submission.
      remember({ ...submission, saved: true });
      setStatus("unavailable");
      setMessage("本轮已完成，页面同步失败，请同步处理状态");
    }
  }, [remember]);

  const check = useCallback(async function reconcile(attempt = 0) {
    if (!mounted.current || request.current || callbacks.current.closed) return;
    if (timer.current) clearTimeout(timer.current);
    recovery.current?.abort();
    const controller = new AbortController();
    recovery.current = controller;
    const version = generation.current;
    let timedOut = false;
    const deadline = setTimeout(() => { timedOut = true; controller.abort(); }, 15000);
    const live = () => mounted.current && recovery.current === controller && (!controller.signal.aborted || timedOut)
      && version === generation.current && !callbacks.current.closed;
    const { apiBase, sessionId, currentQuestion } = callbacks.current;
    setStatus("checking");
    setStartedAt((previous) => previous ?? Date.now());
    try {
      const { items } = await apiRequest<{ items: SavedSubmission[] }>(
        apiBase, `/v1/interview/sessions/${sessionId}/submissions`, { auth: "required", signal: controller.signal },
      );
      if (!live()) return;
      let submission = pending.current;
      if (!submission) {
        const candidate = items.find((item) => item.question_id === currentQuestion?.id);
        if (!candidate) { setStatus("idle"); setMessage(""); return; }
        submission = { ...candidate, saved: true };
        remember(submission);
        callbacks.current.onRestore(submission);
      }
      // Read history after pending state, so completion between the reads is
      // visible in this pass instead of appearing to be an absent submission.
      const history = await apiRequest<TurnHistoryResponse>(
        apiBase, `/v1/interview/sessions/${sessionId}/turns`, { auth: "required", signal: controller.signal },
      );
      if (!live()) return;
      const submissionId = submission.id;
      const completed = history.submissions?.find((item) => item.id === submissionId);
      if (completed) { await complete(completed.result, submission, true); return; }
      const record = items.find((item) => item.id === submissionId);
      if (record) {
        submission = { ...submission, saved: true };
        remember(submission);
        setSaved(true);
      }
      if (record?.status === "running") {
        setMessage(stopped.current ? "正在确认本轮已停止，回答已保存" : "回答已保存，正在确认处理结果");
        if (attempt < 30) timer.current = setTimeout(() => { void reconcile(attempt + 1); }, 3000);
        else { setStatus("unavailable"); setMessage("仍在等待处理结果，请稍后同步状态"); }
        return;
      }
      if (record || !submission.saved) {
        setStatus("retryable");
        setStartedAt(null);
        const text = record
          ? (stopped.current ? "本轮已停止，回答已保存，可重新处理" : "回答已保存，可重试本轮")
          : "尚未确认服务器保存，回答已保留在当前浏览器，可重试";
        setMessage(text);
        callbacks.current.onRestore(submission);
        callbacks.current.onProblem(submission.id, text);
        return;
      }
      // Never infer that a previously saved answer vanished from an empty read.
      setStatus("unavailable");
      setMessage("暂未找到本轮结果，请同步状态后继续");
    } catch {
      if (!live()) return;
      if (attempt < 3) {
        setMessage("连接暂时不可用，正在重新确认处理结果");
        timer.current = setTimeout(() => { void reconcile(attempt + 1); }, 3000);
      } else {
        setStatus("unavailable");
        setMessage("暂时无法连接，请同步状态后继续；当前回答已保留");
      }
    } finally {
      clearTimeout(deadline);
      if (recovery.current === controller) recovery.current = null;
    }
  }, [complete, remember]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      generation.current++;
      request.current?.abort();
      recovery.current?.abort();
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  useEffect(() => {
    if (!options.ready || options.closed || recovering.current) return;
    recovering.current = true;
    try {
      const value = JSON.parse(sessionStorage.getItem(storageKey) || "null");
      if (value && ["id", "question_id", "question", "answer"].every((key) => typeof value[key] === "string")) {
        pending.current = value;
        setSaved(Boolean(value.saved));
        callbacks.current.onRestore(value);
      }
    } catch { /* An invalid cache is ignored. */ }
    if (options.durable) void check();
    else setStatus("idle");
    return () => { recovering.current = false; };
  }, [options.ready, options.closed, options.durable, storageKey, check]);

  useEffect(() => {
    if (options.closed) {
      generation.current++;
      request.current?.abort();
      recovery.current?.abort();
      if (timer.current) clearTimeout(timer.current);
      remember(null);
      setStatus("completed");
      setMessage("");
      setStartedAt(null);
    }
  }, [options.closed, remember]);

  useEffect(() => {
    if (startedAt === null || !busy) return;
    const tick = () => setElapsedMs(Date.now() - startedAt);
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [busy, startedAt]);

  const submit = async (answer: string) => {
    const { currentQuestion: question, closed, apiBase, sessionId, getToken } = callbacks.current;
    if (!callbacks.current.ready || !question || closed || busy || status === "unavailable" || !answer.trim() || request.current) return;
    generation.current++;
    recovery.current?.abort();
    if (timer.current) clearTimeout(timer.current);
    const previous = pending.current;
    const submission: Submission = previous?.question_id === question.id && previous.answer === answer.trim()
      ? previous : { id: crypto.randomUUID(), question_id: question.id, question: question.stem, answer: answer.trim() };
    const controller = new AbortController();
    request.current = controller;
    const version = generation.current;
    const live = () => mounted.current && version === generation.current && !callbacks.current.closed;
    stopped.current = false;
    remember(submission);
    setSaved(Boolean(submission.saved));
    setStatus("sending");
    setStartedAt(Date.now());
    setElapsedMs(0);
    setMessage("");
    setSteps([]);
    callbacks.current.onStart(submission);
    let result: TurnResponse | null = null;
    let interrupted = false;
    try {
      const token = await getToken();
      if (controller.signal.aborted || !live()) throw new Error("cancelled");
      const response = await fetch(`${apiBase}/v1/interview/sessions/${sessionId}/turns/stream`, {
        method: "POST", credentials: "include", signal: controller.signal,
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ submission_id: submission.id, question_id: submission.question_id, question: submission.question, answer: submission.answer }),
      });
      if (!response.ok || !response.body) throw new Error("request_failed");
      setStatus("processing");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "", text = "";
      const frame = (chunk: string) => {
        if (!live()) return;
        const lines = chunk.split(/\r?\n/);
        const event = lines.find((line) => line.startsWith("event:"))?.slice(6).trim();
        const data = lines.filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart()).join("\n");
        if (!data) return;
        const payload = JSON.parse(data);
        if (event === "stage") {
          if (payload.step === "saved") { submission.saved = true; remember(submission); setSaved(true); }
          stage(payload);
        } else if (event === "token" && payload.textChunk) {
          text += payload.textChunk;
          callbacks.current.onToken(submission.id, text);
        } else if (event === "result") result = payload;
        else if (event === "error") throw new Error("processing_failed");
      };
      while (live()) {
        const { value, done } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });
        const chunks = buffer.split(/\r?\n\r?\n/);
        buffer = chunks.pop() || "";
        for (const chunk of chunks) frame(chunk);
        if (done) { if (buffer.trim()) frame(buffer); break; }
      }
      if (!result) throw new Error("response_interrupted");
    } catch {
      interrupted = true;
    } finally {
      if (request.current === controller) request.current = null;
    }
    if (!live()) return;
    if (result) {
      await complete(result, submission, false);
    } else if (interrupted && callbacks.current.durable) {
      setMessage(stopped.current ? "正在确认本轮是否已停止" : "连接中断，正在确认回答和结果");
      await check();
    } else {
      setStatus("retryable");
      setStartedAt(null);
      const text = "本轮响应已中断，回答已保留；请先同步面试进度再重试";
      setMessage(text);
      callbacks.current.onProblem(submission.id, text);
    }
  };

  return {
    status, saved, busy, message, steps, elapsedMs, ready: options.ready,
    canStop: Boolean(request.current) && ["sending", "processing"].includes(status),
    submit,
    stop: () => {
      if (!request.current) return;
      stopped.current = true;
      setStatus("checking");
      setMessage("正在停止本轮并确认处理结果");
      request.current.abort();
    },
    refresh: () => { void check(); },
    resetActivity: () => {
      if (busy) return;
      setStatus("idle"); setSaved(false); setMessage(""); setSteps([]);
      setElapsedMs(0); setStartedAt(null);
    },
  };
}
