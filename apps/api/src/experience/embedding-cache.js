const groupEmbeddings = new Map();

function cosineSimilarity(a, b) {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

function setGroupEmbedding(groupId, embedding) {
  if (!embedding || !embedding.length) return;
  groupEmbeddings.set(groupId, Float32Array.from(embedding));
}

function searchByEmbedding(queryEmbedding, topK = 20) {
  if (!queryEmbedding || !queryEmbedding.length || groupEmbeddings.size === 0) {
    return [];
  }
  const queryVec = Float32Array.from(queryEmbedding);
  const scores = [];
  for (const [groupId, vec] of groupEmbeddings) {
    scores.push({ groupId, score: cosineSimilarity(queryVec, vec) });
  }
  scores.sort((a, b) => b.score - a.score);
  return scores.slice(0, topK);
}

async function loadEmbeddingsFromStore(store) {
  const rows = await store.listExperienceGroupEmbeddings();
  let loaded = 0;
  for (const row of rows) {
    try {
      const embedding = JSON.parse(row.embedding_json);
      if (Array.isArray(embedding) && embedding.length > 0) {
        groupEmbeddings.set(row.id, Float32Array.from(embedding));
        loaded++;
      }
    } catch {
      // skip malformed
    }
  }
  console.log('[embedding-cache.loaded]', { total: rows.length, loaded, cache_size: groupEmbeddings.size });
}

function getEmbeddingCacheSize() {
  return groupEmbeddings.size;
}

module.exports = {
  setGroupEmbedding,
  searchByEmbedding,
  loadEmbeddingsFromStore,
  getEmbeddingCacheSize,
};
