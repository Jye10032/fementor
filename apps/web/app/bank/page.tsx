"use client";

import { useAuthState } from "../../components/auth-provider";
import { BankNavigation } from "../../components/bank-navigation";
import { PagePanel, PageShell } from "../../components/page-shell";
import { useRuntimeConfig } from "../../components/runtime-config";
import { useOfficialQuestionBank } from "./_hooks/use-official-question-bank";
import { OfficialQuestionBank } from "./_components/OfficialQuestionBank";

export default function BankPage() {
  const { apiBase } = useRuntimeConfig();
  const { authEnabled, authReady, authUser, isLoaded, isSignedIn, viewer } = useAuthState();
  const bank = useOfficialQuestionBank(apiBase, {
    enabled: authReady && isLoaded,
    identityKey: authUser?.clerkUserId || viewer?.id || (isSignedIn ? "authenticated" : "anonymous"),
  });

  return (
    <PageShell>
      <BankNavigation />
      <PagePanel>
        <OfficialQuestionBank bank={bank} authEnabled={authEnabled} isSignedIn={isLoaded && isSignedIn} />
      </PagePanel>
    </PageShell>
  );
}
