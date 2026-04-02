const path = require('path');
const fs = require('fs');

const SKELETON_PATH = path.resolve(__dirname, '../../data/knowledge-graph-skeleton.json');

// ── Text normalization: handle formatting variants only ──

function normalizeText(kp) {
  return String(kp || '').trim()
    .replace(/\s+/g, '')           // 去空格: "虚拟 DOM" → "虚拟DOM"
    .replace(/[-_]/g, '')          // 去连字符: "Tree-Shaking" → "TreeShaking"
    .toLowerCase();
}

// ── Fuzzy matching: skeleton vocabulary substring lookup ──

let skeletonVocab = null;
let normalizedVocabMap = null; // normalizeText(name) → original name

function getSkeletonVocab() {
  if (skeletonVocab) return skeletonVocab;
  const skeleton = loadSkeleton();
  const names = new Set();
  for (const [name, node] of Object.entries(skeleton)) {
    names.add(name);
    for (const child of node.children || []) names.add(child);
  }
  // Sort by length desc: longest match first to avoid "CSS" eating "CSRF"
  skeletonVocab = [...names].filter((n) => n.length >= 2).sort((a, b) => b.length - a.length);
  // Build normalized text → original name lookup
  normalizedVocabMap = new Map();
  for (const name of skeletonVocab) {
    const key = normalizeText(name);
    if (!normalizedVocabMap.has(key)) normalizedVocabMap.set(key, name);
  }
  return skeletonVocab;
}

function fuzzyMatchSkeleton(kp) {
  const vocab = getSkeletonVocab();
  for (const term of vocab) {
    if (kp.length >= term.length && kp.includes(term)) return term;
  }
  return null;
}

function normalizeKnowledgePoint(kp) {
  const trimmed = String(kp || '').trim();
  // 1. Exact match against skeleton vocab
  getSkeletonVocab();
  if (normalizedVocabMap.has(normalizeText(trimmed))) {
    return normalizedVocabMap.get(normalizeText(trimmed));
  }
  // 2. Substring fuzzy match
  const fuzzy = fuzzyMatchSkeleton(trimmed);
  if (fuzzy && fuzzy !== trimmed) return fuzzy;
  // 3. Keep as-is
  return trimmed;
}

function normalizeKnowledgePoints(kps) {
  return [...new Set(kps.map(normalizeKnowledgePoint).filter(Boolean))];
}

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
      const kps = normalizeKnowledgePoints(
        (group.items || []).flatMap((item) => {
          const raw = item.knowledge_points_json || item.knowledge_points || '[]';
          return Array.isArray(raw) ? raw : JSON.parse(raw);
        }).filter(Boolean),
      );

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

  // Build skeleton lookup: child → parent, and name → node definition
  const skeletonChildToParent = {};
  for (const [name, node] of Object.entries(skeleton)) {
    for (const child of node.children || []) {
      skeletonChildToParent[child] = name;
    }
  }

  // Only create nodes for tags that actually appear in cooccurrence (from real data)
  for (const [name, data] of Object.entries(cooccurrence)) {
    const skeletonNode = skeleton[name];
    graph[name] = {
      parent: skeletonNode?.parent || skeletonChildToParent[name] || null,
      children: skeletonNode?.children ? [...skeletonNode.children] : [],
      related: {},
      source: skeletonNode || skeletonChildToParent[name] ? 'both' : 'cooccurrence',
    };
    // Seed related from skeleton
    if (skeletonNode) {
      for (const r of Array.isArray(skeletonNode.related) ? skeletonNode.related : []) {
        graph[name].related[r] = 1;
      }
    }
    // Merge cooccurrence weights
    for (const [rel, weight] of Object.entries(data.related)) {
      if (weight >= 1) {
        graph[name].related[rel] = (graph[name].related[rel] || 0) + weight;
      }
    }
  }

  // For nodes in the graph, ensure their skeleton-defined parent also exists
  // (a parent category should appear even if it has no direct cooccurrence data)
  const toAdd = {};
  for (const [name, node] of Object.entries(graph)) {
    if (node.parent && !graph[node.parent] && !toAdd[node.parent]) {
      const parentSkeleton = skeleton[node.parent];
      toAdd[node.parent] = {
        parent: parentSkeleton?.parent || null,
        children: parentSkeleton?.children ? [...parentSkeleton.children] : [name],
        related: {},
        source: 'skeleton',
      };
      if (parentSkeleton) {
        for (const r of Array.isArray(parentSkeleton.related) ? parentSkeleton.related : []) {
          toAdd[node.parent].related[r] = 1;
        }
      }
    }
  }
  Object.assign(graph, toAdd);

  return graph;
}

function inferOrphanParents(graph) {
  // Build a reverse lookup: child name → parent name from skeleton entries
  const childToParent = {};
  for (const [name, node] of Object.entries(graph)) {
    for (const child of node.children || []) {
      if (!childToParent[child]) {
        childToParent[child] = name;
      }
    }
  }

  for (const [name, node] of Object.entries(graph)) {
    if (node.parent) continue;

    // 1. Direct match in skeleton children
    if (childToParent[name]) {
      node.parent = childToParent[name];
      const parentNode = graph[node.parent];
      if (parentNode && !parentNode.children.includes(name)) {
        parentNode.children.push(name);
      }
      continue;
    }

    // 2. Synonym-mapped match
    const normalized = normalizeKnowledgePoint(name);
    if (normalized !== name && childToParent[normalized]) {
      node.parent = childToParent[normalized];
      continue;
    }

    // 3. Fallback: infer from highest-weight related node's parent
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

let buildStatus = { state: 'pending', error: null, skeleton: 0, cooccurrence: 0, nodes: 0 };

function getBuildStatus() {
  return buildStatus;
}

async function buildKnowledgeGraph(store) {
  buildStatus = { state: 'building', error: null, skeleton: 0, cooccurrence: 0, nodes: 0 };
  console.log('[knowledge-graph] starting build...');
  const skeleton = loadSkeleton();
  buildStatus.skeleton = Object.keys(skeleton).length;
  console.log('[knowledge-graph] skeleton loaded:', buildStatus.skeleton, 'entries');
  let cooccurrence = {};
  try {
    cooccurrence = await buildCooccurrenceFromStore(store);
    buildStatus.cooccurrence = Object.keys(cooccurrence).length;
    console.log('[knowledge-graph] cooccurrence built:', buildStatus.cooccurrence, 'tags');
  } catch (error) {
    buildStatus.error = error.message;
    console.warn('[knowledge-graph.cooccurrence.failed]', error.message);
  }
  globalGraph = mergeSkeletonWithCooccurrence(skeleton, cooccurrence);
  inferOrphanParents(globalGraph);
  buildStatus.nodes = Object.keys(globalGraph).length;
  buildStatus.state = 'done';
  console.log('[knowledge-graph.built]', {
    node_count: buildStatus.nodes,
    skeleton_count: buildStatus.skeleton,
    cooccurrence_count: buildStatus.cooccurrence,
  });
}

function updateGraphIncremental(groups) {
  for (const group of groups) {
    const kps = normalizeKnowledgePoints(
      (group.items || []).flatMap((item) => {
        const raw = item.knowledge_points || item.knowledge_points_json || [];
        return Array.isArray(raw) ? raw : [];
      }).filter(Boolean),
    );

    for (let i = 0; i < kps.length; i++) {
      const a = kps[i];
      if (!globalGraph[a]) globalGraph[a] = { parent: null, children: [], related: {}, source: 'cooccurrence' };
      else if (globalGraph[a].source === 'skeleton') globalGraph[a].source = 'both';
      for (let j = i + 1; j < kps.length; j++) {
        const b = kps[j];
        if (!globalGraph[b]) globalGraph[b] = { parent: null, children: [], related: {}, source: 'cooccurrence' };
        else if (globalGraph[b].source === 'skeleton') globalGraph[b].source = 'both';
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
  getBuildStatus,
  updateGraphIncremental,
  expandWithGraph,
  getGraph,
  getLevel2Vocabulary,
  getSkeletonVocab,
  normalizeKnowledgePoint,
  normalizeKnowledgePoints,
};
