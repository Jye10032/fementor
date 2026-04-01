"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { KeyRound, Play, TriangleAlert } from "lucide-react";
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
import { StartSessionLimitError, StartSessionResponse } from "./_lib/interview-page.types";

export default function InterviewPage() {
  const router = useRouter();
  const {
    apiBase,
    refreshSessionLlmConfig,
    sessionLlmConfigured,
    sessionLlmMaskedKey,
    sessionLlmExpiresAt,
  } = useRuntimeConfig();
  const { isSignedIn, viewer } = useAuthState();
  const [starting, setStarting] = useState(false);
  const [useExperienceQuestions, setUseExperienceQuestions] = useState(true);
  const [startError, setStartError] = useState<StartSessionLimitError | null>(null);
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

  const canStart = Boolean(isSignedIn && activeResume && activeJd);
  const remainingInterviewCount = viewer?.capabilities?.remaining_interview_session_count;
  const dailyInterviewLimit = viewer?.capabilities?.daily_interview_session_limit;
  const activeResumeName = activeResume?.original_filename || activeResume?.name;
  const activeJdName = activeJd?.name;

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
      if (error instanceof ApiError && error.code === "NEED_USER_LLM_KEY") {
        setStartError({
          error: "NEED_USER_LLM_KEY",
          remaining_free: 0,
          message: error.message,
        });
        void refreshSessionLlmConfig();
      }
    } finally {
      setStarting(false);
    }
  };

  return (
    <PageShell>
      <section className="fade-in-up space-y-4 rounded-2xl border border-border/70 bg-card/90 p-5 shadow-[var(--shadow-card)] backdrop-blur">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">Mock Interview</p>
            <h1 className="mt-1 text-xl font-semibold text-foreground">模拟面试</h1>
            <p className="mt-1 text-sm text-muted-foreground">每天默认 1 次免费模拟面试。超额后可配置当前会话 LLM Key 继续使用。</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {dailyInterviewLimit != null && remainingInterviewCount != null ? (
              <span className="inline-flex items-center rounded-full border border-border/70 bg-secondary/70 px-3 py-1.5 text-xs text-muted-foreground">
                今日免费次数 {remainingInterviewCount}/{dailyInterviewLimit}
              </span>
            ) : null}
            <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs ${
              sessionLlmConfigured
                ? "border-[color:color-mix(in_oklab,var(--success)_35%,transparent)] bg-[color:color-mix(in_oklab,var(--success)_10%,transparent)] text-[color:var(--success)]"
                : "border-border/70 bg-secondary/70 text-muted-foreground"
            }`}
            >
              <KeyRound className="h-3.5 w-3.5" />
              {sessionLlmConfigured ? `当前会话已配置 ${sessionLlmMaskedKey || ""}` : "当前会话未配置 LLM Key"}
            </span>
          </div>
        </div>

        {startError ? (
          <div className="rounded-xl border border-[color:color-mix(in_oklab,var(--destructive)_35%,transparent)] bg-[color:color-mix(in_oklab,var(--destructive)_8%,transparent)] p-4">
            <div className="flex items-start gap-3">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-[color:var(--destructive)]" />
              <div className="min-w-0">
                <p className="text-sm font-semibold text-foreground">今日免费模拟面试次数已用完</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {startError.message || "请配置你自己的当前会话 LLM Key 后继续发起模拟面试。"}
                </p>
              </div>
            </div>
          </div>
        ) : null}

        {(startError || sessionLlmConfigured) ? (
          <div className="rounded-xl border border-border/70 bg-background/80 p-4">
            <RuntimeConfigPanel />
            {sessionLlmExpiresAt ? (
              <p className="mt-3 text-xs text-muted-foreground">
                当前会话 Key 过期时间：{new Date(sessionLlmExpiresAt).toLocaleString()}
              </p>
            ) : null}
          </div>
        ) : null}

        <div className="rounded-xl border border-border/70 bg-background/80 p-4">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="space-y-3">
              <div>
                <p className="text-sm font-semibold text-foreground">开始前确认</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {canStart
                    ? `本场将基于《${activeResumeName}》与《${activeJdName}》生成题目。`
                    : "先完成简历与 JD 选择，再开始本场模拟面试。"}
                </p>
              </div>

              <button
                type="button"
                onClick={() => setUseExperienceQuestions((value) => !value)}
                className={`flex w-full max-w-xl items-start gap-3 rounded-xl border px-4 py-3 text-left transition-colors ${
                  useExperienceQuestions
                    ? "border-[color:color-mix(in_oklab,var(--primary)_26%,transparent)] bg-[color:color-mix(in_oklab,var(--primary)_8%,transparent)]"
                    : "border-border/70 bg-card"
                }`}
                aria-pressed={useExperienceQuestions}
              >
                <span
                  className={`mt-0.5 inline-flex h-5 w-9 shrink-0 rounded-full p-0.5 transition-colors ${
                    useExperienceQuestions ? "bg-primary" : "bg-secondary"
                  }`}
                >
                  <span
                    className={`h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${
                      useExperienceQuestions ? "translate-x-4" : "translate-x-0"
                    }`}
                  />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-foreground">结合近期真实面经出题</span>
                  <span className="mt-1 block text-sm text-muted-foreground">
                    题目会更贴近近期真实面试的高频考点
                  </span>
                </span>
              </button>
            </div>

            <div className="flex w-full flex-col gap-2 lg:w-auto lg:items-end">
              <p className="text-xs text-muted-foreground">
                开始后将生成题目队列，并进入逐题问答
              </p>
              <button
                type="button"
                onClick={() => void onStart()}
                disabled={starting || !canStart}
                className="action-primary inline-flex w-full cursor-pointer items-center justify-center gap-2 lg:w-auto"
              >
                <Play className="h-4 w-4" />
                {starting ? "启动中..." : "开始模拟面试"}
              </button>
            </div>
          </div>
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
