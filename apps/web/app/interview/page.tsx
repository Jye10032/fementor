"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, CheckCircle2, CircleAlert, KeyRound, Play, TriangleAlert } from "lucide-react";
import { SignInButton } from "@clerk/nextjs";
import { useAuthState } from "../../components/auth-provider";
import { RuntimeConfigPanel } from "../../components/RuntimeConfigPanel";
import { PageShell } from "../../components/page-shell";
import { useRuntimeConfig } from "../../components/runtime-config";
import { ApiError, apiRequest } from "../../lib/api";
import { JdPanel } from "./_components/JdPanel";
import { ResumePanel } from "./_components/ResumePanel";
import { SessionHistoryPanel } from "./_components/SessionHistoryPanel";
import { useInterviewHistory } from "./_hooks/use-interview-history";
import { useJdPanel } from "./_hooks/use-jd-panel";
import { useResumePanel } from "./_hooks/use-resume-panel";
import { StartSessionError, StartSessionResponse } from "./_lib/interview-page.types";

export default function InterviewPage() {
  const router = useRouter();
  const {
    apiBase,
    refreshSessionLlmConfig,
    runtimeMode,
    agentRuntimeId,
    agentRuntimeAvailable,
    agentRuntimeState,
    llmSyncState,
    sessionLlmConfigured,
    sessionLlmMaskedKey,
    sessionLlmExpiresAt,
  } = useRuntimeConfig();
  const { authEnabled, isSignedIn, viewer } = useAuthState();
  const [starting, setStarting] = useState(false);
  const [useExperienceQuestions, setUseExperienceQuestions] = useState(true);
  const [startError, setStartError] = useState<StartSessionError | null>(null);
  const {
    resumeLibrary,
    loadingResumeLibrary,
    switchingResume,
    resumePickerOpen,
    activeResume,
    setResumePickerOpen,
    onSelectResume,
  } = useResumePanel({ apiBase, enabled: isSignedIn });
  const {
    jdLibrary,
    loadingJdLibrary,
    switchingJd,
    jdPickerOpen,
    activeJd,
    setJdPickerOpen,
    onSelectJd,
  } = useJdPanel({ apiBase, enabled: isSignedIn });
  const { sessionHistory, loadingHistory, deleteSession } = useInterviewHistory({ apiBase, enabled: isSignedIn });

  const canStart = Boolean(
    isSignedIn
    && activeResume
    && activeJd
    && agentRuntimeAvailable === true
    && llmSyncState === "ready",
  );
  const remainingInterviewCount = viewer?.capabilities?.remaining_interview_session_count;
  const dailyInterviewLimit = viewer?.capabilities?.daily_interview_session_limit;
  const activeResumeName = activeResume?.original_filename || activeResume?.name;
  const activeJdName = activeJd?.name;
  const supportsSessionByok = runtimeMode === "local" && agentRuntimeId === "native-api";
  const runtimeReady = agentRuntimeAvailable === true;
  const runtimeChecking = agentRuntimeAvailable === null;
  const runtimeStarting = agentRuntimeState === "starting" || agentRuntimeState === "not_started";
  const llmReady = llmSyncState === "ready";
  const startHint = !isSignedIn
    ? "登录并完成检查后开始本场模拟面试。"
    : runtimeChecking
      ? "正在检查面试服务状态，请稍候。"
      : !runtimeReady
        ? runtimeStarting
          ? "面试服务正在启动，请稍候。"
          : "面试服务暂不可用，暂时无法开始。"
        : !llmReady
          ? supportsSessionByok
            ? "配置当前会话 LLM Key 后开始本场面试。"
            : "服务端模型尚未配置，暂时无法开始。"
        : !activeResume || !activeJd
          ? "完成上方检查后开始本场模拟面试。"
          : "开始后将生成题目队列，并进入逐题问答。";
  const readinessItems = [
    {
      id: "auth",
      label: "账号",
      description: isSignedIn ? "已登录，结果会保存到你的记录" : "登录后才能开始并保存本场面试",
      complete: isSignedIn,
      href: undefined,
    },
    {
      id: "resume",
      label: "简历",
      description: activeResume ? activeResumeName || "已选择简历" : "选择一份用于出题的简历",
      complete: Boolean(activeResume),
      href: "/resume?tab=resume",
    },
    {
      id: "jd",
      label: "目标 JD",
      description: activeJd ? activeJdName || "已选择 JD" : "选择一个目标岗位 JD",
      complete: Boolean(activeJd),
      href: "/resume?tab=jd",
    },
    {
      id: "runtime",
      label: "系统状态",
      complete: runtimeReady,
      description: runtimeReady
        ? "服务已就绪，可以开始面试"
        : runtimeChecking
          ? "正在检查面试服务状态"
          : runtimeStarting
            ? "面试服务正在启动，请稍候"
            : "面试服务暂不可用，请稍后重试",
      href: undefined,
    },
    {
      id: "llm",
      label: "生成模型",
      complete: llmReady,
      description: llmReady
        ? "已就绪，可以生成面试题目"
        : runtimeChecking
          ? "等待系统状态检查完成"
          : supportsSessionByok
            ? "配置当前会话 LLM Key 后开始"
            : "服务端模型尚未配置",
      href: undefined,
    },
  ] as const;

  const startErrorTitle = startError?.error === "DAILY_LIMIT_REACHED"
    ? "今日免费模拟面试次数已用完"
    : startError?.error === "NEED_USER_LLM_KEY"
      ? "需要配置当前会话模型"
      : "面试暂时无法启动";
  const startErrorFallback = startError?.error === "DAILY_LIMIT_REACHED"
    ? "今日额度将在次日恢复。"
    : startError?.error === "NEED_USER_LLM_KEY"
      ? "请配置当前会话 LLM Key 后继续发起模拟面试。"
      : "请检查简历、JD 和模型配置后重试。";

  const onStart = async () => {
    if (!canStart) return;
    try {
      setStarting(true);
      setStartError(null);
      const interview = await apiRequest<StartSessionResponse>(apiBase, "/v1/interview/sessions/start", {
        method: "POST",
        body: JSON.stringify({
          target_level: "mid",
          use_experience_questions: useExperienceQuestions,
        }),
        auth: "required",
      });
      const query = new URLSearchParams({ session_id: interview.id });
      router.push(`/interview/session?${query.toString()}`);
    } catch (error) {
      const knownErrorCode = error instanceof ApiError
        && (error.code === "NEED_USER_LLM_KEY" || error.code === "DAILY_LIMIT_REACHED")
        ? error.code
        : null;
      setStartError({
        error: knownErrorCode || "START_FAILED",
        remaining_free: 0,
        message: knownErrorCode && error instanceof ApiError ? error.message : undefined,
      });
      if (knownErrorCode && supportsSessionByok) void refreshSessionLlmConfig();
    } finally {
      setStarting(false);
    }
  };

  return (
    <PageShell>
      <section className="fade-in-up border-b border-border/70 pb-7 md:pb-8">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-xs font-medium text-muted-foreground">模拟面试</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight text-foreground">准备开始</h1>
            <p className="mt-1.5 text-sm text-muted-foreground">
              {supportsSessionByok ? "每天默认 1 次，完成后可以继续复盘和训练。" : "完成检查后，开始一场 10–15 分钟的针对性面试。"}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground lg:pt-2">
            {dailyInterviewLimit != null && remainingInterviewCount != null ? (
              <span>今日剩余 {remainingInterviewCount}/{dailyInterviewLimit}</span>
            ) : null}
            {supportsSessionByok ? (
              <span className={sessionLlmConfigured ? "inline-flex items-center gap-1.5 text-[color:var(--success)]" : "inline-flex items-center gap-1.5"}>
                <KeyRound className="h-3.5 w-3.5" />
                {sessionLlmConfigured ? `Key 已配置 ${sessionLlmMaskedKey || ""}` : "Key 未配置"}
              </span>
            ) : null}
          </div>
        </div>

        {startError ? (
          <div className="mt-5 flex items-start gap-3 border-l-2 border-[color:var(--destructive)] pl-3">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-[color:var(--destructive)]" />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-foreground">{startErrorTitle}</p>
              <p className="mt-1 text-sm text-muted-foreground">{startError.message || startErrorFallback}</p>
            </div>
          </div>
        ) : null}

        {supportsSessionByok && (startError || sessionLlmConfigured) ? (
          <div className="mt-5 border-t border-border/70 pt-5">
            <RuntimeConfigPanel />
            {sessionLlmExpiresAt ? (
              <p className="mt-3 text-xs text-muted-foreground">当前会话 Key 过期时间：{new Date(sessionLlmExpiresAt).toLocaleString()}</p>
            ) : null}
          </div>
        ) : null}

        <div className="mt-7 grid gap-8 lg:grid-cols-[minmax(0,1fr)_280px] lg:items-start">
          <div className="min-w-0 border-l-2 border-primary/35 pl-4 sm:pl-5">
            <p className="text-xs font-semibold text-primary">下一步</p>
            <div className="mt-2 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h2 className="text-xl font-semibold text-foreground sm:text-2xl">
                  {canStart ? "资料已就绪，可以开始面试" : "完成准备后开始面试"}
                </h2>
                <p className="mt-1.5 max-w-xl text-sm text-muted-foreground">
                  {canStart ? `本场将基于《${activeResumeName}》与《${activeJdName}》生成题目。` : startHint}
                </p>
              </div>
              <button
                type="button"
                onClick={() => void onStart()}
                disabled={starting || !canStart}
                className="action-primary inline-flex w-full shrink-0 cursor-pointer items-center justify-center gap-2 sm:w-auto"
              >
                <Play className="h-4 w-4" />
                {starting ? "启动中..." : "开始模拟面试"}
              </button>
            </div>

            <div className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-3 border-y border-border/70 py-3 text-sm">
              <div className="min-w-0">
                <span className="mr-2 text-xs text-muted-foreground">简历</span>
                <span className="font-medium text-foreground">{activeResumeName || "未选择"}</span>
              </div>
              <div className="min-w-0">
                <span className="mr-2 text-xs text-muted-foreground">目标 JD</span>
                <span className="font-medium text-foreground">{activeJdName || "未选择"}</span>
              </div>
              <span className="text-xs text-muted-foreground">预计 10–15 分钟</span>
            </div>

            <button
              type="button"
              onClick={() => setUseExperienceQuestions((value) => !value)}
              className="mt-4 inline-flex items-center gap-2 text-left text-xs text-muted-foreground transition-colors hover:text-foreground"
              aria-pressed={useExperienceQuestions}
              title="让题目参考近期公开面经"
            >
              <span className={`inline-flex h-4 w-7 rounded-full p-0.5 ${useExperienceQuestions ? "bg-primary" : "bg-secondary"}`}>
                <span className={`h-3 w-3 rounded-full bg-card transition-transform ${useExperienceQuestions ? "translate-x-3" : "translate-x-0"}`} />
              </span>
              <span>结合近期真实面经出题</span>
            </button>
          </div>

          <aside className="border-t border-border/70 pt-4 lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0">
            <p className="text-xs font-semibold text-foreground">准备状态</p>
            <div className="mt-3 divide-y divide-border/60">
              {readinessItems.map((item) => (
                <div key={item.id} className="flex items-start gap-2.5 py-2.5 first:pt-0 last:pb-0">
                  {item.complete ? (
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[color:var(--success)]" />
                  ) : (
                    <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-medium text-foreground">{item.label}</p>
                      <span className="shrink-0 text-[11px] text-muted-foreground">{item.complete ? "完成" : "待处理"}</span>
                    </div>
                    <p className="mt-0.5 text-xs leading-5 text-muted-foreground">{item.description}</p>
                    {!item.complete && item.id === "auth" && authEnabled ? (
                      <SignInButton mode="modal">
                        <button type="button" className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline">
                          立即登录 <ArrowRight className="h-3 w-3" />
                        </button>
                      </SignInButton>
                    ) : !item.complete && item.href ? (
                      <Link href={item.href} className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline">
                        去处理 <ArrowRight className="h-3 w-3" />
                      </Link>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          </aside>
        </div>
      </section>

      {/* Main layout */}
      <div className="fade-in-up-delay-1 grid gap-5 lg:grid-cols-[minmax(0,1fr)_240px]">
        <main className="space-y-4">
          <ResumePanel
            resumeLibrary={resumeLibrary}
            activeResume={activeResume}
            loading={loadingResumeLibrary}
            resumePickerOpen={resumePickerOpen}
            switchingResume={switchingResume}
            onTogglePicker={() => setResumePickerOpen((value) => !value)}
            onCloseOtherPicker={() => setJdPickerOpen(false)}
            onSelectResume={(fileName) => void onSelectResume(fileName)}
          />

          <JdPanel
            jdLibrary={jdLibrary}
            activeJd={activeJd}
            loading={loadingJdLibrary}
            jdPickerOpen={jdPickerOpen}
            switchingJd={switchingJd}
            onTogglePicker={() => setJdPickerOpen((value) => !value)}
            onCloseOtherPicker={() => setResumePickerOpen(false)}
            onSelectJd={(fileName) => void onSelectJd(fileName)}
          />
        </main>

        <aside>
          <SessionHistoryPanel
            loadingHistory={loadingHistory}
            sessionHistory={sessionHistory}
            onDeleteSession={deleteSession}
          />
        </aside>
      </div>
    </PageShell>
  );
}
