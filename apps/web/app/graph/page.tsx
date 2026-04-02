"use client";

import { useEffect, useRef, useState } from "react";
import * as d3 from "d3";
import { useRuntimeConfig } from "../../components/runtime-config";
import { apiRequest } from "../../lib/api";

type GraphNode = {
  parent: string | null;
  children: string[];
  related: Record<string, number>;
};

type GraphData = Record<string, GraphNode>;

type SimNode = d3.SimulationNodeDatum & {
  id: string;
  level: number;
  parent: string | null;
  category: string;
  color: string;
};

type SimLink = d3.SimulationLinkDatum<SimNode> & {
  type: "parent" | "related";
};

// 已知一级分类的固定配色，保证颜色稳定
const PINNED_COLORS: Record<string, string> = {
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

// 备用调色板，供新增一级分类使用
const EXTRA_PALETTE = [
  "#06b6d4", "#d946ef", "#84cc16", "#f97316", "#6366f1",
  "#ec4899", "#14b8a6", "#eab308", "#8b5cf6", "#0ea5e9",
];

const FALLBACK_COLOR = "#64748b";

// 从图谱数据中提取一级分类（无 parent 的节点），构建完整的分类→颜色映射
function buildCategoryColors(graph: GraphData): Record<string, string> {
  const colors = { ...PINNED_COLORS };
  const roots = Object.entries(graph)
    .filter(([, node]) => !node.parent)
    .map(([name]) => name)
    .filter((name) => !(name in colors))
    .sort(); // 排序保证同样数据分配结果一致
  let idx = 0;
  for (const name of roots) {
    colors[name] = idx < EXTRA_PALETTE.length ? EXTRA_PALETTE[idx++] : FALLBACK_COLOR;
  }
  return colors;
}

function findRootCategory(name: string, graph: GraphData, rootSet: Set<string>): string {
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

function buildD3Data(graph: GraphData) {
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
    });
    nodeSet.add(name);
  }

  for (const [name, node] of Object.entries(graph)) {
    for (const child of node.children) {
      if (nodeSet.has(child)) {
        links.push({ source: name, target: child, type: "parent" });
      }
    }
    for (const [rel] of Object.entries(node.related)) {
      if (nodeSet.has(rel) && name < rel) {
        links.push({ source: name, target: rel, type: "related" });
      }
    }
  }

  return { nodes, links, categoryColors };
}

export default function GraphPage() {
  const { apiBase } = useRuntimeConfig();
  const containerRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState({ nodes: 0, edges: 0 });
  const [legend, setLegend] = useState<Record<string, string>>({});
  const simulationRef = useRef<d3.Simulation<SimNode, SimLink> | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        setLoading(true);
        const data = await apiRequest<{ graph: GraphData }>(apiBase, "/v1/knowledge-graph", { auth: "none" });
        if (cancelled || !containerRef.current) return;
        const { nodes, links, categoryColors } = buildD3Data(data.graph);
        setStats({ nodes: nodes.length, edges: links.length });
        setLegend(categoryColors);
        renderGraph(containerRef.current, nodes, links, simulationRef);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "加载失败");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => { cancelled = true; simulationRef.current?.stop(); };
  }, [apiBase]);

  return (
    <div className="relative h-[calc(100vh-57px)] w-full overflow-hidden bg-slate-100">
      <div className="absolute top-5 left-5 z-10">
        <h1 className="text-lg font-semibold text-slate-800">前端知识图谱</h1>
        <p className="mt-1 text-xs text-slate-500">
          {loading ? "加载中..." : error ? error : `${stats.nodes} 节点 · ${stats.edges} 条边 | 拖拽节点 / 滚轮缩放 / 点击高亮`}
        </p>
      </div>
      <div className="absolute bottom-5 left-5 z-10 rounded-lg border border-slate-200 bg-white/90 px-4 py-3 shadow-sm">
        {Object.entries(legend).map(([cat, color]) => (
          <div key={cat} className="flex items-center gap-2 py-0.5 text-xs text-slate-600">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: color }} />
            {cat}
          </div>
        ))}
        <div className="mt-2 flex items-center gap-2 text-xs text-slate-500">
          <span className="inline-block h-0.5 w-5 bg-slate-300" /> 父子关系
        </div>
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <span className="inline-block h-0 w-5 border-t-2 border-dashed border-slate-300" /> 共现关联
        </div>
      </div>
      <div ref={containerRef} className="h-full w-full" />
    </div>
  );
}

function getRadius(level: number) {
  return level === 0 ? 20 : level === 1 ? 10 : 6;
}

function renderGraph(
  container: HTMLDivElement,
  nodes: SimNode[],
  links: SimLink[],
  simulationRef: React.MutableRefObject<d3.Simulation<SimNode, SimLink> | null>,
) {
  // 1. 清空容器，获取画布尺寸，创建 Canvas（2x DPR 保证清晰度）
  container.innerHTML = "";
  const width = container.clientWidth;
  const height = container.clientHeight;
  const dpr = window.devicePixelRatio || 1;

  const canvas = document.createElement("canvas");
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  container.appendChild(canvas);

  const ctx = canvas.getContext("2d")!;
  ctx.scale(dpr, dpr);

  // 2. 创建悬浮提示框（DOM div），初始透明
  const tooltipEl = document.createElement("div");
  Object.assign(tooltipEl.style, {
    position: "absolute", background: "#ffffff", border: "1px solid #e2e8f0",
    borderRadius: "8px", padding: "10px 14px", fontSize: "13px",
    pointerEvents: "none", opacity: "0", zIndex: "20", maxWidth: "280px",
    color: "#334155", transition: "opacity 0.15s", boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
  });
  container.appendChild(tooltipEl);

  // 3. 缩放/平移状态
  let transform = d3.zoomIdentity;

  // 4. 预构建邻接表，加速 hover/click 时的关联查找
  const adjacency = new Map<string, { parents: Set<string>; related: Set<string> }>();
  for (const n of nodes) {
    adjacency.set(n.id, { parents: new Set(), related: new Set() });
  }
  for (const l of links) {
    const sId = typeof l.source === "object" ? (l.source as SimNode).id : (l.source as string);
    const tId = typeof l.target === "object" ? (l.target as SimNode).id : (l.target as string);
    if (l.type === "related") {
      adjacency.get(sId)?.related.add(tId);
      adjacency.get(tId)?.related.add(sId);
    } else {
      adjacency.get(sId)?.parents.add(tId);
      adjacency.get(tId)?.parents.add(sId);
    }
  }

  // 5. 交互状态
  let hoveredNode: SimNode | null = null;
  let selectedId: string | null = null;
  let connectedSet: Set<string> | null = null;

  // 6. 初始化力导向模拟
  const simulation = d3.forceSimulation<SimNode>(nodes)
    .alphaDecay(0.05)
    .force("link", d3.forceLink<SimNode, SimLink>(links).id((d) => d.id).distance((d) => d.type === "parent" ? 60 : 100).strength((d) => d.type === "parent" ? 0.8 : 0.15))
    .force("charge", d3.forceManyBody<SimNode>().strength((d) => d.level === 0 ? -600 : d.level === 1 ? -200 : -80))
    .force("center", d3.forceCenter(width / 2, height / 2))
    .force("collision", d3.forceCollide<SimNode>().radius((d) => getRadius(d.level) + 8));

  simulationRef.current = simulation;

  // 7. Canvas 绘制函数
  function draw() {
    ctx.save();
    ctx.clearRect(0, 0, width, height);
    ctx.translate(transform.x, transform.y);
    ctx.scale(transform.k, transform.k);

    // 绘制连线
    for (const l of links) {
      const s = l.source as SimNode;
      const t = l.target as SimNode;
      // 点击高亮时淡化无关连线
      if (connectedSet) {
        const sConn = connectedSet.has(s.id) && connectedSet.has(t.id);
        ctx.globalAlpha = sConn ? 0.9 : 0.03;
      } else {
        ctx.globalAlpha = 0.6;
      }
      ctx.beginPath();
      ctx.moveTo(s.x!, s.y!);
      if (l.type === "related") {
        ctx.setLineDash([4, 3]);
        ctx.strokeStyle = "#cbd5e1";
        ctx.lineWidth = 0.8;
      } else {
        ctx.setLineDash([]);
        ctx.strokeStyle = "#94a3b8";
        ctx.lineWidth = 1.5;
      }
      ctx.lineTo(t.x!, t.y!);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;

    // 绘制节点
    for (const n of nodes) {
      const r = getRadius(n.level);
      let alpha = n.level === 0 ? 1 : n.level === 1 ? 0.85 : 0.65;
      if (connectedSet) alpha = connectedSet.has(n.id) ? 1 : 0.08;

      ctx.globalAlpha = alpha;
      ctx.beginPath();
      ctx.arc(n.x!, n.y!, r, 0, Math.PI * 2);
      ctx.fillStyle = n.color;
      ctx.fill();
      // 描边：hover 时加粗
      ctx.strokeStyle = hoveredNode === n ? "#334155" : "#f1f5f9";
      ctx.lineWidth = hoveredNode === n ? 3 : 1.5;
      ctx.stroke();
    }

    // 绘制标签
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    for (const n of nodes) {
      let alpha = 1;
      if (connectedSet) alpha = connectedSet.has(n.id) ? 1 : 0;
      ctx.globalAlpha = alpha;
      const r = getRadius(n.level);
      ctx.font = n.level === 0 ? "600 13px sans-serif" : n.level === 1 ? "400 10px sans-serif" : "400 8px sans-serif";
      ctx.fillStyle = n.level === 0 ? "#1e293b" : "#475569";
      ctx.fillText(n.id, n.x!, n.y! - r - 6);
    }

    ctx.globalAlpha = 1;
    ctx.restore();
  }

  // 8. tick 回调：每帧重绘 Canvas
  simulation.on("tick", draw);

  // 9. 坐标命中检测：找到鼠标下的节点
  function hitTest(mx: number, my: number): SimNode | null {
    // 将屏幕坐标转换为模拟坐标
    const [sx, sy] = transform.invert([mx, my]);
    // 从上层节点开始检测（后绘制的在上面）
    for (let i = nodes.length - 1; i >= 0; i--) {
      const n = nodes[i];
      const dx = sx - n.x!;
      const dy = sy - n.y!;
      if (dx * dx + dy * dy < (getRadius(n.level) + 4) ** 2) return n;
    }
    return null;
  }

  // 10. 缩放行为 + 拖拽行为（合并处理，避免事件冲突）
  let dragNode: SimNode | null = null;

  const zoomBehavior = d3.zoom<HTMLCanvasElement, unknown>()
    .scaleExtent([0.2, 4])
    .filter((e) => {
      // 鼠标按下时，如果命中节点则交给拖拽处理，不触发 zoom 平移
      if (e.type === "mousedown" || e.type === "touchstart") {
        const rect = canvas.getBoundingClientRect();
        const mx = (e as MouseEvent).clientX - rect.left;
        const my = (e as MouseEvent).clientY - rect.top;
        if (hitTest(mx, my)) return false;
      }
      return true;
    })
    .on("zoom", (e) => { transform = e.transform; draw(); });
  d3.select(canvas).call(zoomBehavior);

  // 拖拽节点：mousedown 命中节点时启动
  let dragStartX = 0;
  let dragStartY = 0;

  canvas.addEventListener("mousedown", (e) => {
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const hit = hitTest(mx, my);
    if (!hit) return;

    dragNode = hit;
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    simulation.alphaTarget(0.3).restart();
    hit.fx = hit.x;
    hit.fy = hit.y;

    const onMouseMove = (ev: MouseEvent) => {
      if (!dragNode) return;
      const [sx, sy] = transform.invert([ev.clientX - rect.left, ev.clientY - rect.top]);
      dragNode.fx = sx;
      dragNode.fy = sy;
    };

    const onMouseUp = () => {
      if (dragNode) {
        simulation.alphaTarget(0);
        dragNode.fx = null;
        dragNode.fy = null;
        dragNode = null;
      }
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  });

  // 11. hover 交互
  canvas.addEventListener("mousemove", (e) => {
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const hit = hitTest(mx, my);

    if (hit !== hoveredNode) {
      hoveredNode = hit;
      canvas.style.cursor = hit ? "pointer" : "default";
      draw();
    }

    if (hit) {
      const adj = adjacency.get(hit.id);
      const relatedNames = adj ? [...adj.related] : [];
      let html = `<div style="font-weight:600;color:#1e293b;margin-bottom:4px">${hit.id}</div>`;
      html += hit.parent
        ? `<div style="color:#64748b;font-size:12px">父节点: ${hit.parent} | 分类: ${hit.category}</div>`
        : `<div style="color:#64748b;font-size:12px">一级分类</div>`;
      if (relatedNames.length) html += `<div style="color:#0891b2;font-size:12px;margin-top:4px">关联: ${relatedNames.join(", ")}</div>`;
      tooltipEl.innerHTML = html;
      tooltipEl.style.opacity = "1";
      tooltipEl.style.left = `${e.offsetX + 12}px`;
      tooltipEl.style.top = `${e.offsetY - 10}px`;
    } else {
      tooltipEl.style.opacity = "0";
    }
  });

  canvas.addEventListener("mouseleave", () => {
    hoveredNode = null;
    tooltipEl.style.opacity = "0";
    draw();
  });

  // 12. 点击高亮（过滤掉拖拽产生的 click）
  canvas.addEventListener("click", (e) => {
    // 如果鼠标移动超过 5px，视为拖拽而非点击
    if (Math.abs(e.clientX - dragStartX) > 5 || Math.abs(e.clientY - dragStartY) > 5) return;

    const rect = canvas.getBoundingClientRect();
    const hit = hitTest(e.clientX - rect.left, e.clientY - rect.top);

    if (!hit) {
      selectedId = null;
      connectedSet = null;
    } else if (selectedId === hit.id) {
      selectedId = null;
      connectedSet = null;
    } else {
      selectedId = hit.id;
      connectedSet = new Set([hit.id]);
      const adj = adjacency.get(hit.id);
      if (adj) {
        for (const id of adj.parents) connectedSet.add(id);
        for (const id of adj.related) connectedSet.add(id);
      }
    }
    draw();
  });
}
