const path = require('path');
const fs = require('fs');

const SKELETON_PATH = path.resolve(__dirname, '../../data/knowledge-graph-skeleton.json');

let globalGraph = {};

function loadSkeleton() {
  try {
    const raw = fs.readFileSync(SKELETON_PATH, 'utf-8');
    return JSON.parse(raw);
  } catch (error) {
    console.warn('[knowledge-graph.skeleton.failed]', error.message);
    return {};
  }
}

async function buildCooccurrenceFromStore(store) {
  const cooccurrence = {};
  const postIds = await store.listExperiencePostIds({ onlyValid: true });

  for (const postId of postIds) {
    const detail = await store.getExperiencePostDetail(postId);
    if (!detail) continue;
    const groups = detail.groups || [];

    for (const group of groups) {
      const kps = [...new Set(
        (group.items || []).flatMap((item) => {
          const raw = item.knowledge_points_json || item.knowledge_points || '[]';
          return Array.isArray(raw) ? raw : JSON.parse(raw);
        }).filter(Boolean),
      )];

      for (let i = 0; i < kps.length; i++) {
        const a = kps[i];
        if (!cooccurrence[a]) cooccurrence[a] = { count: 0, related: {} };
        cooccurrence[a].count++;
        for (let j = i + 1; j < kps.length; j++) {
          const b = kps[j];
          if (!cooccurrence[b]) cooccurrence[b] = { count: 0, related: {} };
          cooccurrence[b].count++;
          cooccurrence[a].related[b] = (cooccurrence[a].related[b] || 0) + 1;
          cooccurrence[b].related[a] = (cooccurrence[b].related[a] || 0) + 1;
        }
      }
    }
  }

  return cooccurrence;
}

function mergeSkeletonWithCooccurrence(skeleton, cooccurrence) {
  const graph = {};

  for (const [name, node] of Object.entries(skeleton)) {
    graph[name] = {
      parent: node.parent || null,
      children: Array.isArray(node.children) ? [...node.children] : [],
      related: {},
    };
    for (const r of Array.isArray(node.related) ? node.related : []) {
      graph[name].related[r] = 1;
    }
  }

  for (const [name, data] of Object.entries(cooccurrence)) {
    if (!graph[name]) {
      graph[name] = { parent: null, children: [], related: {} };
    }
    for (const [rel, weight] of Object.entries(data.related)) {
      if (weight >= 1) {
        graph[name].related[rel] = (graph[name].related[rel] || 0) + weight;
      }
    }
  }

  return graph;
}

function inferOrphanParents(graph) {
  for (const [name, node] of Object.entries(graph)) {
    if (node.parent) continue;
    if (Object.keys(node.related).length === 0) continue;
    const topRelated = Object.entries(node.related).sort((a, b) => b[1] - a[1]);
    for (const [relatedName] of topRelated) {
      const relatedNode = graph[relatedName];
      if (relatedNode?.parent) {
        node.parent = relatedNode.parent;
        const parentNode = graph[relatedNode.parent];
        if (parentNode && !parentNode.children.includes(name)) {
          parentNode.children.push(name);
        }
        break;
      }
    }
  }
}

async function buildKnowledgeGraph(store) {
  const skeleton = loadSkeleton();
  let cooccurrence = {};
  try {
    cooccurrence = await buildCooccurrenceFromStore(store);
  } catch (error) {
    console.warn('[knowledge-graph.cooccurrence.failed]', error.message);
  }
  globalGraph = mergeSkeletonWithCooccurrence(skeleton, cooccurrence);
  inferOrphanParents(globalGraph);
  console.log('[knowledge-graph.built]', {
    node_count: Object.keys(globalGraph).length,
    skeleton_count: Object.keys(skeleton).length,
    cooccurrence_count: Object.keys(cooccurrence).length,
  });
}

function updateGraphIncremental(groups) {
  for (const group of groups) {
    const kps = [...new Set(
      (group.items || []).flatMap((item) => {
        const raw = item.knowledge_points || item.knowledge_points_json || [];
        return Array.isArray(raw) ? raw : [];
      }).filter(Boolean),
    )];

    for (let i = 0; i < kps.length; i++) {
      const a = kps[i];
      if (!globalGraph[a]) globalGraph[a] = { parent: null, children: [], related: {} };
      for (let j = i + 1; j < kps.length; j++) {
        const b = kps[j];
        if (!globalGraph[b]) globalGraph[b] = { parent: null, children: [], related: {} };
        globalGraph[a].related[b] = (globalGraph[a].related[b] || 0) + 1;
        globalGraph[b].related[a] = (globalGraph[b].related[a] || 0) + 1;
      }
    }
  }
}

function expandWithGraph(techEntities, { maxDepth = 1, maxPerNode = 5, minWeight = 2 } = {}) {
  const expanded = new Map();
  for (const entity of techEntities) {
    expanded.set(entity, 10);
  }

  let currentLayer = [...techEntities];
  for (let depth = 0; depth < maxDepth; depth++) {
    const nextLayer = [];
    const decay = 1 / (depth + 2);

    for (const term of currentLayer) {
      const node = globalGraph[term];
      if (!node) continue;
      const neighbors = Object.entries(node.related)
        .filter(([, weight]) => weight >= minWeight)
        .sort((a, b) => b[1] - a[1])
        .slice(0, maxPerNode);

      for (const [neighbor, coWeight] of neighbors) {
        const score = coWeight * decay;
        if (!expanded.has(neighbor) || expanded.get(neighbor) < score) {
          expanded.set(neighbor, score);
          nextLayer.push(neighbor);
        }
      }
    }
    currentLayer = nextLayer;
  }
  return expanded;
}

function getGraph() {
  if (Object.keys(globalGraph).length === 0) {
    const skeleton = loadSkeleton();
    if (Object.keys(skeleton).length > 0) {
      globalGraph = mergeSkeletonWithCooccurrence(skeleton, {});
      inferOrphanParents(globalGraph);
    }
  }
  return globalGraph;
}

function getLevel2Vocabulary() {
  const graph = globalGraph;
  const terms = [];
  for (const [name, node] of Object.entries(graph)) {
    if (node.children && node.children.length > 0) {
      terms.push(...node.children);
    }
  }
  return [...new Set(terms)];
}

module.exports = {
  buildKnowledgeGraph,
  updateGraphIncremental,
  expandWithGraph,
  getGraph,
  getLevel2Vocabulary,
};
