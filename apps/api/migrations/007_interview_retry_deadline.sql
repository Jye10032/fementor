-- Persist provider backoff independently of the ephemeral agent execution.
ALTER TABLE interview_answer_submission ADD COLUMN retry_not_before TEXT;
