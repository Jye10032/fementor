"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { SignInButton } from "@clerk/nextjs";
import { useAuthState } from "../../components/auth-provider";
import { PageShell } from "../../components/page-shell";
import { useRuntimeConfig } from "../../components/runtime-config";
import { apiRequest } from "../../lib/api";
import { InterviewSetupPanel } from "./_components/InterviewSetupPanel";
import { JdPanel } from "./_components/JdPanel";
import { ResumePanel } from "./_components/ResumePanel";
import { SessionHistoryPanel } from "./_components/SessionHistoryPanel";
import { useInterviewHistory } from "./_hooks/use-interview-history";
import { useJdPanel } from "./_hooks/use-jd-panel";
import { useResumePanel } from "./_hooks/use-resume-panel";
import { StartSessionResponse } from "./_lib/interview-page.types";

export default function InterviewPage() {
  const router = useRouter();
  const { apiBase } = useRuntimeConfig();
  const { authEnabled, isLoaded, isSignedIn, viewer } = useAuthState();
  const [starting, setStarting] = useState(false);
  const [useExperienceQuestions, setUseExperienceQuestions] = useState(true);
  const [experienceQuery, setExperienceQuery] = useState("前端 面经");
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
  const { sessionHistory, loadingHistory } = useInterviewHistory({ apiBase, enabled: isSignedIn });

  const canStart = Boolean(isSignedIn && activeResume && activeJd);

  const onStart = async () => {
    if (!canStart) return;
    try {
      setStarting(true);
      const interview = await apiRequest<StartSessionResponse>(apiBase, "/v1/interview/sessions/start", {
        method: "POST",
        body: JSON.stringify({
          target_level: "mid",
          use_experience_questions: useExperienceQuestions,
          experience_query: experienceQuery,
        }),
        auth: "required",
      });
      const query = new URLSearchParams({ session_id: interview.id });
      router.push(`/interview/session?${query.toString()}`);
    } catch {
      // ignore
    } finally {
      setStarting(false);
    }
  };

  return (
    <PageShell>
      {/* Header */}
      <header className="fade-in-up flex flex-col gap-4 rounded-[1.5rem] border border-border/80 bg-card/90 p-5 shadow-[var(--shadow-card)] backdrop-blur sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">Mock Interview</p>
          <h1 className="mt-1 text-xl font-semibold text-foreground">模拟面试</h1>
          <p className="mt-1 text-sm text-muted-foreground">选择简历和 JD，开始 AI 面试。</p>
        </div>
        {isLoaded && (
          <div className="shrink-0">
            {isSignedIn ? (
              <span className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-secondary/70 px-3 py-1.5 text-xs text-muted-foreground">
                <span className="inline-block h-2 w-2 rounded-full bg-[var(--accent)]" />
                {viewer?.name || viewer?.email || "已登录"}
              </span>
            ) : !authEnabled ? (
              <span className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-secondary/70 px-3 py-1.5 text-xs text-muted-foreground">
                登录未启用
              </span>
            ) : (
              <SignInButton mode="modal">
                <button type="button" className="action-primary cursor-pointer">
                  立即登录
                </button>
              </SignInButton>
            )}
          </div>
        )}
      </header>

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
          />
        </aside>
      </div>

      <InterviewSetupPanel
        activeResume={activeResume}
        activeJd={activeJd}
        canStart={canStart}
        starting={starting}
        useExperienceQuestions={useExperienceQuestions}
        onUseExperienceQuestionsChange={setUseExperienceQuestions}
        experienceQuery={experienceQuery}
        onExperienceQueryChange={setExperienceQuery}
        onStart={() => void onStart()}
      />
    </PageShell>
  );
}
