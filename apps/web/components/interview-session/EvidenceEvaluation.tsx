"use client";

import { useEffect, useState } from "react";
import { apiRequest } from "../../lib/api";

type Observation = { dimension: string; assessment: string; claim: string; basis: string;
  evidence: { turn_id: string; question_id: string | null; quote: string }[] };
type Response = { generation_enabled: boolean; evaluation: null | { contract_version: string;
  provenance: { assistance: string }; result: { observations: Observation[]; uncertainties: string[];
    suggestion: { purpose: string; direction: string; reason: string } } } };
const dimensions: Record<string, string> = { correctness: "正确性", explanation: "解释能力", application: "应用能力", diagnosis: "排障与验证", tradeoffs: "方案权衡" };
const assessments: Record<string, string> = { strength: "优势表现", development: "发展方向", uncertain: "尚不确定" };
const bases: Record<string, string> = { answer_demonstration: "回答表现", self_report: "个人陈述", hypothesis: "待核实推测" };
export function EvidenceEvaluation({ apiBase, sessionId, turnId }: { apiBase: string; sessionId: string; turnId: string }) {
  const [data, setData] = useState<Response | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const path = `/v1/interview/sessions/${encodeURIComponent(sessionId)}/turns/${encodeURIComponent(turnId)}/evidence`;
  useEffect(() => {
    let active = true;
    setData(null); setError("");
    apiRequest<Response>(apiBase, path).then((result) => { if (active) setData(result); })
      .catch(() => { if (active) setData(null); });
    return () => { active = false; };
  }, [apiBase, path]);
  if (!data || (!data.generation_enabled && !data.evaluation)) return null;
  async function evaluate() {
    setBusy(true); setError("");
    try { setData(await apiRequest<Response>(apiBase, path, { method: "POST", body: "{}" })); }
    catch { setError("证据评价暂时不可用，请稍后重试。原有面试记录未改变。"); }
    finally { setBusy(false); }
  }
  return <details className="rounded-lg border border-border p-3 text-sm">
    <summary className="cursor-pointer">本轮证据观察（试验）</summary>
    <p className="my-2 text-muted-foreground">仅描述本次回答，不判断岗位通过，不改变历史评分。历史提示记录未知，不能据此认定独立掌握。</p>
    {!data.evaluation && <button type="button" disabled={busy} onClick={() => void evaluate()} className="rounded border px-3 py-1">{busy ? "正在整理…" : "整理本轮证据"}</button>}
    {error && <p role="alert">{error}</p>}
    {data.evaluation && <>
      {data.evaluation.result.observations.length === 0 && <p>本轮没有足够依据形成能力观察。</p>}
      {data.evaluation.result.observations.map((item, index) => <div key={index} className="my-3">
        <p className="font-medium">{dimensions[item.dimension]} · {assessments[item.assessment]} · {bases[item.basis]}</p>
        <p>{item.claim}</p>
        {item.evidence.map((evidence, i) => <blockquote key={i} className="border-l-2 pl-3 text-muted-foreground">{evidence.quote}</blockquote>)}
      </div>)}
      {data.evaluation.result.uncertainties.map((item, i) => <p key={i}>待核实：{item}</p>)}
      <p className="mt-2">后续探索建议：{data.evaluation.result.suggestion.reason}</p>
    </>}
  </details>;
}
