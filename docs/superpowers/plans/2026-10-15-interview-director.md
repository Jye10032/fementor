# FEMentor Interview Director Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Connect an autonomous main Codex interviewer to serial, isolated evaluation/question specialists and the existing durable interview submission flow.

**Architecture:** The host injects role/Skill/state and registered dynamic tools. Codex chooses actions and specialists; the host binds inputs, validates artifacts, enforces budgets and commits atomically. Each root/child attempt owns an ephemeral Railway Sandbox.

**Tech Stack:** Node.js 24, CommonJS, Codex 0.162.1 app-server, Railway SDK 3.13.1, AJV, PostgreSQL/SQLite, React.

**Spec:** docs/specs/interview-director-v1.md

## Global Constraints

- User-approved scope: autonomous interview action/expert choice; Runtime and model server-configured.
- 1 root + serial children; at most 2 expert calls, 4 main model requests, 900000 ms main execution; specialists retain 240000 ms setup / 120000 ms execution.
- No secrets or private-network access in Sandbox. Unknown tools and approvals fail closed.
- Preserve workflow fallback and existing uncommitted evidence-profile work; do not deploy evidence-profile changes.
- No commits/push of the imported dirty baseline; compare task changes against its saved hash manifest and copy only owned changes back.

## Task 1: Bounded dynamic tools and root/child Sandbox lifecycle

**Files:** Modify apps/api/src/agent-runtime/codex/{app-server-client,model-relay,runtime,config,interview-runner,run-journal}.js; create tool-gateway.js; add focused protocol/permission checks.

**Interfaces:**
- `new CodexSandboxRuntime({config, taskSpec, toolGateway, ...existing})`; omitted taskSpec retains scorer.
- taskSpec: `{taskType, buildBundle(input), parseOutput(text,input)}`. Bundle may contain `dynamicTools` fixed by host, never from user input.
- `runCodexInterviewDirector({interviewSessionId,input,taskSpec,onTool,signal,onPhase})` calls `onTool({name,args,callId,signal,runChild})`; `runChild({taskSpec,input})` uses a fresh no-tools specialist. Return validated output with existing `agent_runtime` metadata.
- Gateway supplies only host specs and verified call/result history to relay; callbacks cannot be selected by VM.

- [x] Implement Codex 0.162.1 dynamic tool protocol: initialize experimentalApi, thread/start dynamicTools, item/tool/call response, thread/turn/call fencing, bounded duplicate replay and cancellation. Use generated schemas in /tmp/fementor-director-protocol.
```js
const response = {success:true, contentItems:[{type:'inputText', text:JSON.stringify(result)}]};
```
- [x] Keep scorer relay tools empty. Director relay rebuilds allowlisted function definitions, sets parallel_tool_calls=false, verifies function history against gateway records and substitutes host output; no arbitrary options/references/files forwarded.
- [x] Register root before dispatch, admit children only through its live closure, cap/serialize them, propagate root cancellation, await child cleanup, retain both run records. Recovery recognizes exact old/director/question profile allowlist.
- [x] Inspect protocol and lifecycle checks, including unauthorized tools/history and old scoring compatibility; report changed paths and observations.

## Task 2: Role bundles, durable specialist artifacts, autonomous business commit

**Files:** Create apps/api/src/interview/director/{contracts,service,artifact-store}.js; apps/api/skills/{interview-director,interview-question-design}/SKILL.md; migrations/006_interview_agent_artifact.sql. Modify turn-service.js, turn-context.js, turn-commit.js, db/init.js, agent-runtime/contracts.js, .env.example; route question listing must reflect completed status.

**Interfaces:**
- `submitInterviewTurnDirector(options)` takes the same authenticated options/claimed submission as unified workflow.
- `buildDirectorBundle(input)`, `parseDirectorDecision(text,input)`, `buildQuestionBundle(input)`, `parseDesignedQuestion(text,input)` implement Task 1's taskSpec.
- `saveArtifact({submission,expert,callId,result})` returns `{artifact_id,expert,result}`; lookup only against current attempt's in-memory verified artifact set.

- [x] Inject Chinese role/Skill/data distinction, known tools, allowed topics/questions, and fixed final schema.
```js
const taskSpec = {taskType:'direct-interview', buildBundle:buildDirectorBundle, parseOutput:parseDirectorDecision};
```
- [x] Persist schema-validated expert artifacts before returning to root; bind current original question/answer and server configuration. Use existing evaluator bundle; question expert produces one bounded question.
- [x] Extend the snapshot plan with explicit finish and bounded queue-selection support. Validate all action/ref combinations and commit scores only from current evaluation artifact, keeping clarify/skip score-free. Do not execute old fixed follow-up policy after director output.
- [x] Route server feature flag after durable submission claim; rebuild bounded conversation history including non-answer submissions; retain original answer and idempotent completed replay.
- [x] Verify business outcomes and invalid references with isolated fixtures; record persistence and cancellation limits.

## Task 3: UI integration, staging acceptance and documentation

**Files:** Modify apps/web/components/interview-session-room.tsx, interview-session/{types,copy}.ts only as required. Add apps/api/scripts/codex-director-smoke.js and relevant checks. Update main architecture, Railway sandbox design and implementation list.

**Interfaces:** Director response extends existing result with `session_status` and `agent_decision` (action/reason/artifact IDs), keeping existing score, reply_text and next_question semantics.

- [x] Keep current question after clarify; respect server completed status immediately and after reload; no automatic switch back to pending topics after early finish.
```ts
if (data.session_status === 'completed') setSessionDetail(previous => previous ? {...previous,status:'completed'} : previous);
```
- [x] Review the complete change independently and resolve actionable issues. Run appropriate existing/focused checks, not unrelated broad work.
- [x] Deploy a manifest-pinned source snapshot to codex-staging API only, migrate independent test PostgreSQL, enable director and run real main/specialist chain plus clarify and finish; confirm destroyed Sandbox IDs. Preserve prior rollback artifact and production deployment IDs.
- [x] Update status using observed evidence; do not mark cloud/crash cases complete without execution. Copy owned task changes back only if original baseline hashes still match.

Acceptance evidence: Railway deployment `521775da-eb8d-44ac-a177-fc59a8487004`, fixture `9e8fe288-8269-40bf-86aa-101c7eadcd42`; clarify/follow_up/finish passed, 23 score, 2 artifacts, 3 completed submissions, 5 destroyed sandboxes. See architecture/railway-agent-sandbox-design.md §14.5 for latency and remaining cloud-crash/frontend limits.

## Task 4: Director interaction and independent staging web (2026-10-20)

User approved continuing with frontend integration, independent staging deployment, and real Clerk browser acceptance. The frontend consumes host progress and validated decision summaries; it does not expose raw model reasoning.

- [x] Replace the fixed linear progress display with actual host stages, saved state, elapsed time, and a collapsible stage history.
- [x] Keep feedback visible until the user chooses to continue. Clarification stays on the current question; a completed interview stays completed after refresh.
- [x] Separate stopping this turn from finishing the interview. Reconcile server state before allowing retry or another action; preserve the original submission ID.
- [x] Recover a saved answer, a lost final response, and interrupted requests without duplicating dialogue. Bound status reads and lock input while completion or recovery is unresolved.
- [x] Show the validated `agent_decision.reason` as “面试官的下一步安排” or an ending explanation. Do not label this as full chain of thought.
- [x] Independently review changes; pass TypeScript and backend syntax checks. Manually exercise local browser fixtures for clarify, stop/retry, refresh/retry, lost response, manual next, finish, and reload. These are synthetic UI checks, not cloud scoring acceptance.
- [x] Prepare isolated API/web source bundles and create `codex-staging-web`. Reuse the configured Clerk instance, with authentication still required and secrets kept out of build context.
- [x] Confirm the independent web deployment and same-origin API proxy.
- [x] Complete hosted Clerk browser sign-in and a real Codex scoring round through the staging web UI; record stage timings, durable result, and sandbox cleanup. The unchanged answer succeeded on attempt 3: score 88, one submission/one formal score, `next_question`, 108.125 seconds from the successful browser submit to commit. All six sandboxes were destroyed; manual next and reload recovery passed.
- [x] Recheck production deployment IDs and record the exact delivery boundary. Production variables are unchanged, but another Git-sourced deployment of `ce1abff` appeared during this work; its API failed on pending migration 004. Do not describe production deployments as unchanged or run a production migration under this staging task.

The earlier 281.97-second round is historical evidence. This UI work does not establish a latency improvement. Main/child simultaneous crash and multi-replica recovery remain separate acceptance items.

The first two scoring experts failed with `codex_turn_failed`; a separate staging model-relay diagnostic returned `service_unavailable_error/server_error` with an overload message. Preserve both failed attempts and do not treat attempt 3 as reliability acceptance. Next work is safe upstream-error classification/recovery and measured startup/model latency; this run selected an existing question and used only one expert, unlike the earlier two-expert sample.
