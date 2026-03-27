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
  const { isLoaded, isSignedIn, viewer } = useAuthState();
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
      <div className="tool-page">
        <header className="tool-header">
          <div className="space-y-1">
            <h1 className="tool-heading">模拟面试</h1>
            <p className="tool-subheading">选择简历和 JD，开始 AI 面试。</p>
          </div>
        </header>

        <section className="tool-section">
          {!isLoaded ? (
            <p className="text-sm text-muted-foreground">正在同步登录态...</p>
          ) : isSignedIn ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-foreground">
                  当前已登录：{viewer?.name || viewer?.email || "已登录用户"}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  面试记录、简历选择和历史会话会绑定到当前 viewer。
                </p>
              </div>
              <span className="rounded-full border border-border/70 bg-secondary/70 px-3 py-1 text-xs text-muted-foreground">
                登录态优先
              </span>
            </div>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-foreground">开始模拟面试前需要先登录。</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  简历选择、JD 选择、历史会话和本场回答都会关联到当前用户。
                </p>
              </div>
              <SignInButton mode="modal">
                <button type="button" className="action-primary">
                  立即登录
                </button>
              </SignInButton>
            </div>
          )}
        </section>

        <div className="tool-layout">
          <aside className="tool-sidebar">
            <SessionHistoryPanel
              loadingHistory={loadingHistory}
              sessionHistory={sessionHistory}
            />
          </aside>

          <main className="tool-main">
            <div className="space-y-4">
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
            </div>
          </main>
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
      </div>
    </PageShell>
  );
}
