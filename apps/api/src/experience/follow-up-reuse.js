const { chatCompletion, jsonCompletion, hasRealLLM } = require('../llm');
const { getExperienceStore } = require('./store');
const { setGroupEmbedding } = require('./embedding-cache');
const { updateGraphIncremental } = require('./knowledge-graph');
const { randomUUID } = require('crypto');

const INTENT_PRIORITY = { deepen: 4, compare: 3, verify: 2, scenario: 2, clarify: 1 };

function rankFollowUpByRelevance(chainItems, knowledgeBoundary) {
  const shallow = new Set(knowledgeBoundary.mentioned_but_shallow || []);
  const absent = new Set(knowledgeBoundary.conspicuously_absent || []);

  return chainItems
    .map((item) => {
      const kps = item.knowledge_points || [];
      let score = 0;
      for (const kp of kps) {
        if (shallow.has(kp)) score += 5;
        if (absent.has(kp)) score += 3;
      }
      score += INTENT_PRIORITY[item.follow_up_intent] || 0;
      return { ...item, _relevanceScore: score };
    })
    .sort((a, b) => b._relevanceScore - a._relevanceScore)[0] || null;
}

async function adaptFollowUp({ bankItem, currentQuestion, lastAnswer, resumeAnchor, sessionContext }) {
  if (!hasRealLLM()) return bankItem.question_text_normalized;

  const instruction = bankItem.chain_anchor === 'experience_anchored'
    ? '这道题原本针对特定项目经历。请结合候选人简历，把通用问题重新锚定到候选人的具体项目上。'
    : '把题库问题改写为口语化追问，贴合当前对话上下文。';

  const result = await chatCompletion({
    sessionContext,
    messages: [
      {
        role: 'system',
        content: `你是面试官。${instruction}只改措辞，不改考察点。直接输出改写后的一句话，不要输出其他内容。`,
      },
      {
        role: 'user',
        content: JSON.stringify({
          original_question: bankItem.question_text_normalized,
          knowledge_points: bankItem.knowledge_points,
          candidate_resume_project: resumeAnchor || '',
          current_question: currentQuestion || '',
          recent_answer_excerpt: String(lastAnswer || '').slice(0, 300),
        }),
      },
    ],
  });

  const adapted = String(result || '').trim();
  return adapted || bankItem.question_text_normalized;
}

function saveFollowUpToExperienceBank({ parentQuestion, followUpStem, followUpData }) {
  setImmediate(async () => {
    try {
      console.log('[follow-up.writeback]', {
        parent_stem: String(parentQuestion.stem || '').slice(0, 60),
        follow_up_stem: String(followUpStem || '').slice(0, 60),
        source_ref: parentQuestion.source_ref,
      });
    } catch (error) {
      console.warn('[follow-up.writeback.failed]', error.message);
    }
  });
}

async function selectOrGenerateFollowUp({
  queuedQuestion,
  answer,
  knowledgeBoundary,
  weaknesses,
  interviewContext,
  sessionContext,
  generateFollowUpQuestion,
}) {
  const followUpChain = queuedQuestion?._follow_up_chain;
  if (Array.isArray(followUpChain) && followUpChain.length > 0 && knowledgeBoundary) {
    const selected = rankFollowUpByRelevance(followUpChain, knowledgeBoundary);
    if (selected) {
      const adaptedStem = await adaptFollowUp({
        bankItem: selected,
        currentQuestion: queuedQuestion.stem,
        lastAnswer: answer,
        resumeAnchor: queuedQuestion.resume_anchor,
        sessionContext,
      });
      return {
        source: 'experience',
        question_type: 'follow_up',
        difficulty: selected.difficulty || 'medium',
        stem: adaptedStem,
        expected_points: selected.expected_points || [],
        resume_anchor: queuedQuestion.resume_anchor || '',
        source_ref: `follow_up_of:${queuedQuestion.id}`,
        status: 'asked',
      };
    }
  }

  const generated = await generateFollowUpQuestion({
    queuedQuestion,
    answer,
    weaknesses,
    interviewContext,
    sessionContext,
  });

  saveFollowUpToExperienceBank({
    parentQuestion: queuedQuestion,
    followUpStem: generated.stem,
    followUpData: generated,
  });

  return generated;
}

module.exports = {
  selectOrGenerateFollowUp,
  rankFollowUpByRelevance,
  adaptFollowUp,
};
