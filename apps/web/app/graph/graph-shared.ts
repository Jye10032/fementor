import * as d3 from "d3";

export type GraphNode = {
  parent: string | null;
  children: string[];
  related: Record<string, number>;
};

export type GraphData = Record<string, GraphNode>;

export type SimNode = d3.SimulationNodeDatum & {
  id: string;
  level: number;
  parent: string | null;
  category: string;
  color: string;
};

export type SimLink = d3.SimulationLinkDatum<SimNode> & {
  source: string;
  target: string;
  type: "parent" | "related";
};

export const PINNED_COLORS: Record<string, string> = {
  JavaScript: "#facc15",
  React: "#60a5fa",
  Vue: "#34d399",
  CSS: "#f472b6",
  "浏览器": "#fb923c",
  "工程化": "#a78bfa",
  "性能优化": "#2dd4bf",
  "算法": "#f87171",
  "Node.js": "#38bdf8",
  TypeScript: "#818cf8",
  "网络": "#e879f9",
  "安全": "#f43f5e",
  "数据库": "#fbbf24",
  "行为面": "#4ade80",
  "项目": "#22d3ee",
  AI: "#c084fc",
};

export const EXTRA_PALETTE = [
  "#06b6d4", "#d946ef", "#84cc16", "#f97316", "#6366f1",
  "#ec4899", "#14b8a6", "#eab308", "#8b5cf6", "#0ea5e9",
];

export const FALLBACK_COLOR = "#64748b";

export function buildCategoryColors(graph: GraphData): Record<string, string> {
  const colors = { ...PINNED_COLORS };
  const roots = Object.entries(graph)
    .filter(([, node]) => !node.parent)
    .map(([name]) => name)
    .filter((name) => !(name in colors))
    .sort();
  let idx = 0;
  for (const name of roots) {
    colors[name] = idx < EXTRA_PALETTE.length ? EXTRA_PALETTE[idx++] : FALLBACK_COLOR;
  }
  return colors;
}

export function findRootCategory(name: string, graph: GraphData, rootSet: Set<string>): string {
  const visited = new Set<string>();
  let current = name;
  while (current && !visited.has(current)) {
    visited.add(current);
    if (rootSet.has(current)) return current;
    const node = graph[current];
    if (node?.parent) current = node.parent;
    else break;
  }
  return "JavaScript";
}

export function buildD3Data(graph: GraphData) {
  const categoryColors = buildCategoryColors(graph);
  const rootSet = new Set(Object.keys(categoryColors));
  const nodes: SimNode[] = [];
  const links: SimLink[] = [];
  const nodeSet = new Set<string>();

  for (const [name, node] of Object.entries(graph)) {
    const hasChildren = node.children.length > 0;
    const hasParent = Boolean(node.parent);
    const level = !hasParent && rootSet.has(name) ? 0 : !hasParent && hasChildren ? 0 : hasParent ? (graph[node.parent!]?.children.length ? 1 : 2) : 1;
    const category = findRootCategory(name, graph, rootSet);
    nodes.push({
      id: name,
      level: rootSet.has(name) ? 0 : level,
      parent: node.parent,
      category,
      color: categoryColors[category] || FALLBACK_COLOR,
    } as SimNode);
    nodeSet.add(name);
  }

  for (const [name, node] of Object.entries(graph)) {
    for (const child of node.children) {
      if (nodeSet.has(child)) {
        links.push({ source: name, target: child, type: "parent" } as SimLink);
      }
    }
    for (const [rel] of Object.entries(node.related)) {
      if (nodeSet.has(rel) && name < rel) {
        links.push({ source: name, target: rel, type: "related" } as SimLink);
      }
    }
  }

  return { nodes, links, categoryColors };
}

export interface GraphComponentProps {
  apiBase: string;
  onStats: (stats: { nodes: number; edges: number }) => void;
  onLegend: (legend: Record<string, string>) => void;
  onHover: (node: SimNode | null) => void;
}
