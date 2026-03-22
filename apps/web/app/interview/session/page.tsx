import { InterviewSessionRoom } from "../../../components/interview-session-room";

type PageProps = {
  searchParams?: Promise<{
    session_id?: string;
  }>;
};

export default async function InterviewSessionPage({ searchParams }: PageProps) {
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  return <InterviewSessionRoom initialSessionId={String(resolvedSearchParams?.session_id || "")} />;
}
