const { embeddingCompletion } = require('../llm');
const { searchByEmbedding, getEmbeddingCacheSize } = require('./embedding-cache');
const { expandWithGraph } = require('./knowledge-graph');
const { getExperienceStore } = require('./store');

const DIFFICULTY_FIT = {
  junior: { easy: 3, medium: 2, hard: 0 },
  mid: { easy: 1, medium: 3, hard: 2 },
  senior: { easy: 0, medium: 2, hard: 3 },
};

function buildEnhancedQuery(projectDesc, expandedTerms) {
  const topTerms = [...expandedTerms.entries()]
    .filter(([term]) => !projectDesc.includes(term))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([term]) => term);

  return topTerms.length > 0
    ? `${projectDesc}。相关: ${topTerms.join(' ')}`
    : projectDesc;
}

function rerankWithGraph(hits, expandedTerms) {
  if (hits.length === 0) return hits;
  const maxGraphBonus = Math.max(
    ...hits.map((hit) => {
      const kps = (hit.items || []).flatMap((item) => item.knowledge_points || []);
      return kps.reduce((sum, kp) => sum + (expandedTerms.get(kp) || 0), 0);
    }),
    1,
  );

  return hits.map((hit) => {
    const kps = (hit.items || []).flatMap((item) => item.knowledge_points || []);
    const rawBonus = kps.reduce((sum, kp) => sum + (expandedTerms.get(kp) || 0), 0);
    const normalizedBonus = (rawBonus / maxGraphBonus) * 10;
    return { ...hit, finalScore: (hit.cosineSimilarity || 0) * 10 + normalizedBonus };
  }).sort((a, b) => b.finalScore - a.finalScore);
}

function rankRecalledChains({ chains, targetLevel = 'mid', weaknessTags = [], askedKnowledgePoints = [], limit = 2 }) {
  const scored = chains.map((chain) => {
    const chainKPs = (chain.items || []).flatMap((item) => item.knowledge_points || []);
    const uniqueKPs = [...new Set(chainKPs)];

    const mainDifficulty = chain.items?.[0]?.difficulty || 'medium';
    const difficultyScore = DIFFICULTY_FIT[targetLevel]?.[mainDifficulty] ?? 1;
    const weaknessScore = uniqueKPs.filter((kp) => weaknessTags.includes(kp)).length * 5;
    const qualityScore = (chain.frequency_score || 0) * 2;
    const overlapPenalty = uniqueKPs.filter((kp) => askedKnowledgePoints.includes(kp)).length * -4;
    const chainBonus = chain.group_type === 'chain' ? 3 : 0;
    const scoreBonus = chain.finalScore || 0;

    return {
      ...chain,
      _rankScore: scoreBonus + difficultyScore + weaknessScore + qualityScore + overlapPenalty + chainBonus,
      _knowledgePoints: uniqueKPs,
    };
  });

  scored.sort((a, b) => b._rankScore - a._rankScore);

  const selected = [];
  const coveredKPs = new Set(askedKnowledgePoints);
  for (const chain of scored) {
    if (selected.length >= limit) break;
    const overlap = chain._knowledgePoints.filter((kp) => coveredKPs.has(kp)).length;
    if (chain._knowledgePoints.length > 0 && overlap / chain._knowledgePoints.length > 0.7) continue;
    selected.push(chain);
    chain._knowledgePoints.forEach((kp) => coveredKPs.add(kp));
  }
  return selected;
}

async function recallExperienceChains({ resumeStructured, targetLevel = 'mid', weaknessTags = [], limit = 2, sessionContext }) {
  if (getEmbeddingCacheSize() === 0) return [];

  const projects = Array.isArray(resumeStructured?.projects) ? resumeStructured.projects : [];
  const allTechEntities = Array.isArray(resumeStructured?.all_tech_entities) ? resumeStructured.all_tech_entities : [];
  if (projects.length === 0 && allTechEntities.length === 0) return [];

  const expandedTerms = expandWithGraph(allTechEntities);

  const allHits = new Map();
  for (const project of projects) {
    const desc = String(project.original_description || project.description || project.name || '').trim();
    if (!desc) continue;

    const enhancedQuery = buildEnhancedQuery(desc, expandedTerms);
    try {
      const queryEmbedding = await embeddingCompletion({ input: enhancedQuery, sessionContext });
      const hits = searchByEmbedding(queryEmbedding, limit * 8);
      for (const hit of hits) {
        if (!allHits.has(hit.groupId) || allHits.get(hit.groupId).score < hit.score) {
          allHits.set(hit.groupId, hit);
        }
      }
    } catch (error) {
      console.warn('[recall.embedding.failed]', { project: project.name, error: error.message });
    }
  }

  if (allHits.size === 0) return [];

  const store = getExperienceStore();
  const groupIds = [...allHits.keys()];
  const groupsWithItems = await store.getExperienceGroupsWithItems(groupIds);

  const enriched = groupsWithItems.map((group) => ({
    ...group,
    cosineSimilarity: allHits.get(group.id)?.score || 0,
  }));

  const reranked = rerankWithGraph(enriched, expandedTerms);
  return rankRecalledChains({ chains: reranked, targetLevel, weaknessTags, limit });
}

async function recallQuestionForKeyword({ keyword, resumeAnchor, targetLevel = 'mid', sessionContext }) {
  if (getEmbeddingCacheSize() === 0) return null;
  if (!keyword) return null;

  const expandedTerms = expandWithGraph([keyword], { maxDepth: 1, maxPerNode: 5, minWeight: 1 });
  const queryText = resumeAnchor
    ? `${keyword} ${resumeAnchor}。相关: ${[...expandedTerms.keys()].slice(0, 5).join(' ')}`
    : `${keyword}。相关: ${[...expandedTerms.keys()].slice(0, 5).join(' ')}`;

  try {
    const queryEmbedding = await embeddingCompletion({ input: queryText, sessionContext });
    const hits = searchByEmbedding(queryEmbedding, 10);
    if (hits.length === 0) return null;

    const store = getExperienceStore();
    const groupIds = hits.map((h) => h.groupId);
    const groupsWithItems = await store.getExperienceGroupsWithItems(groupIds);

    const enriched = groupsWithItems.map((group) => ({
      ...group,
      cosineSimilarity: hits.find((h) => h.groupId === group.id)?.score || 0,
    }));

    const reranked = rerankWithGraph(enriched, expandedTerms);
    const selected = rankRecalledChains({ chains: reranked, targetLevel, limit: 1 });
    return selected[0] || null;
  } catch (error) {
    console.warn('[recall.keyword.failed]', { keyword, error: error.message });
    return null;
  }
}

module.exports = {
  recallExperienceChains,
  recallQuestionForKeyword,
};
