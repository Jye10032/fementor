"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { PageShell } from "../../components/page-shell";
import { useAuthState } from "../../components/auth-provider";
import { useRuntimeConfig } from "../../components/runtime-config";
import { useResumeLibrary } from "./_hooks/use-resume-library";
import { useJdLibrary } from "./_hooks/use-jd-library";
import { ResumeUploadForm } from "./_components/ResumeUploadForm";
import { ResumeLibraryList } from "./_components/ResumeLibraryList";
import { JdUploadForm } from "./_components/JdUploadForm";
import { JdLibraryList } from "./_components/JdLibraryList";
import type { Tab } from "./_lib/resume.types";

export default function ResumePage() {
  return (
    <Suspense fallback={<PageShell><div className="tool-empty">页面加载中...</div></PageShell>}>
      <ResumePageContent />
    </Suspense>
  );
}

function ResumePageContent() {
  const searchParams = useSearchParams();
  const initialTab = (searchParams.get("tab") === "jd" ? "jd" : "resume") as Tab;
  const [activeTab, setActiveTab] = useState<Tab>(initialTab);
  const { apiBase } = useRuntimeConfig();
  const { isSignedIn, refreshViewer } = useAuthState();

  const resume = useResumeLibrary(apiBase, isSignedIn, refreshViewer);
  const jd = useJdLibrary(apiBase, isSignedIn);

  useEffect(() => {
    void resume.refreshResumeLibrary();
    void jd.refreshJdLibrary();
  }, [apiBase, isSignedIn]);

  return (
    <PageShell>
      <div className="fade-in-up-delay-1 inline-flex self-start rounded-xl border border-border bg-background p-1">
        <button
          type="button"
          onClick={() => setActiveTab("resume")}
          className={`cursor-pointer rounded-lg px-4 py-2 text-sm font-semibold transition-colors duration-200 ${
            activeTab === "resume" ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-secondary"
          }`}
        >
          简历
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("jd")}
          className={`cursor-pointer rounded-lg px-4 py-2 text-sm font-semibold transition-colors duration-200 ${
            activeTab === "jd" ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-secondary"
          }`}
        >
          JD
        </button>
      </div>

      {activeTab === "resume" && (
        <div className="fade-in-up grid gap-5 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
          <ResumeUploadForm
            name={resume.name} setName={resume.setName}
            resumeFilename={resume.resumeFilename} setResumeFilename={resume.setResumeFilename}
            resumeText={resume.resumeText} setResumeText={resume.setResumeText}
            resumeFileStatus={resume.resumeFileStatus}
            uploadingResumeFile={resume.uploadingResumeFile}
            parsingResume={resume.parsingResume}
            canParseResume={resume.canParseResume}
            isSignedIn={isSignedIn}
            resumeDragOver={resume.resumeDragOver} setResumeDragOver={resume.setResumeDragOver}
            handleResumeDrop={resume.handleResumeDrop}
            onResumeFileChange={resume.onResumeFileChange}
            onParseResume={resume.onParseResume}
          />
          <ResumeLibraryList
            resumeLibrary={resume.resumeLibrary}
            loadingResume={resume.loadingResume}
            isSignedIn={isSignedIn}
            selectingResume={resume.selectingResume}
            deletingResume={resume.deletingResume}
            onSelectResume={resume.onSelectResume}
            onDeleteResume={resume.onDeleteResume}
          />
        </div>
      )}

      {activeTab === "jd" && (
        <div className="fade-in-up grid gap-5 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
          <JdUploadForm
            jdFilename={jd.jdFilename} setJdFilename={jd.setJdFilename}
            jdText={jd.jdText} setJdText={jd.setJdText}
            jdFileStatus={jd.jdFileStatus}
            uploadingJdFile={jd.uploadingJdFile}
            savingJd={jd.savingJd}
            canSaveJd={jd.canSaveJd}
            jdDragOver={jd.jdDragOver} setJdDragOver={jd.setJdDragOver}
            handleJdDrop={jd.handleJdDrop}
            onJdFileChange={jd.onJdFileChange}
            onSaveJd={jd.onSaveJd}
          />
          <JdLibraryList
            jdLibrary={jd.jdLibrary}
            loadingJd={jd.loadingJd}
            isSignedIn={isSignedIn}
            selectingJd={jd.selectingJd}
            deletingJd={jd.deletingJd}
            onSelectJd={jd.onSelectJd}
            onDeleteJd={jd.onDeleteJd}
          />
        </div>
      )}
    </PageShell>
  );
}
