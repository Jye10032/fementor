import { InterviewSessionRoom } from "../../../components/interview-session-room";

type PageProps = {
  searchParams?: {
    session_id?: string;
  };
};

export default function InterviewSessionPage({ searchParams }: PageProps) {
  return <InterviewSessionRoom initialSessionId={String(searchParams?.session_id || "")} />;
}
