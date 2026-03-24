"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
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
  const { apiBase, userId } = useRuntimeConfig();
  const [starting, setStarting] = useState(false);
  const {
    resumeLibrary,
    loadingResumeLibrary,
    switchingResume,
    resumePickerOpen,
    activeResume,
    setResumePickerOpen,
    onSelectResume,
  } = useResumePanel({ apiBase, userId });
  const {
    jdLibrary,
    loadingJdLibrary,
    switchingJd,
    jdPickerOpen,
    activeJd,
    setJdPickerOpen,
    onSelectJd,
  } = useJdPanel({ apiBase, userId });
  const { sessionHistory, loadingHistory } = useInterviewHistory({ apiBase, userId });

  const canStart = Boolean(activeResume && activeJd);

  const onStart = async () => {
    if (!canStart) return;
    try {
      setStarting(true);
      const interview = await apiRequest<StartSessionResponse>(apiBase, "/v1/interview/sessions/start", {
        method: "POST",
        body: JSON.stringify({ user_id: userId, target_level: "mid" }),
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
          onStart={() => void onStart()}
        />
      </div>
    </PageShell>
  );
}
