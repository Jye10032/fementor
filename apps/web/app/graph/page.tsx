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
  // 1. 清空容器，获取画布尺寸
  container.innerHTML = "";
  const width = container.clientWidth;
  const height = container.clientHeight;

  // 2. 创建 SVG 画布，g 作为所有图形元素的容器（用于整体缩放/平移）
  const svg = d3.select(container).append("svg").attr("width", width).attr("height", height);
  const g = svg.append("g");

  // 3. 绑定缩放行为：滚轮缩放范围 0.2x ~ 4x，变换应用到 g 容器
  const zoom = d3.zoom<SVGSVGElement, unknown>().scaleExtent([0.2, 4]).on("zoom", (e) => g.attr("transform", e.transform));
  svg.call(zoom);

  // 4. 初始化力导向模拟
  //    - link: 连线弹簧力，父子边短且强，共现边长且弱
  //    - charge: 节点间斥力，层级越高斥力越大以留出空间
  //    - center: 将整体图形锚定到画布中心
  //    - collision: 碰撞检测，防止节点重叠
  const simulation = d3.forceSimulation<SimNode>(nodes)
    .alphaDecay(0.05)
    .force("link", d3.forceLink<SimNode, SimLink>(links).id((d) => d.id).distance((d) => d.type === "parent" ? 60 : 100).strength((d) => d.type === "parent" ? 0.8 : 0.15))
    .force("charge", d3.forceManyBody<SimNode>().strength((d) => d.level === 0 ? -600 : d.level === 1 ? -200 : -80))
    .force("center", d3.forceCenter(width / 2, height / 2))
    .force("collision", d3.forceCollide<SimNode>().radius((d) => getRadius(d.level) + 8));

  simulationRef.current = simulation;

  // 5. 绘制连线：父子关系用实线，共现关联用虚线，颜色和粗细做区分
  const link = g.append("g").selectAll("line").data(links).join("line")
    .attr("stroke", (d) => d.type === "parent" ? "#94a3b8" : "#cbd5e1")
    .attr("stroke-width", (d) => d.type === "parent" ? 1.5 : 0.8)
    .attr("stroke-dasharray", (d) => d.type === "related" ? "4,3" : null)
    .attr("opacity", 0.6);

  // 6. 绘制节点圆形：半径按层级递减，填充色按分类着色，透明度按层级递减
  //    绑定拖拽行为：拖拽时固定节点位置，松开后释放回模拟
  const node = g.append("g").selectAll<SVGCircleElement, SimNode>("circle").data(nodes).join("circle")
    .attr("r", (d) => getRadius(d.level))
    .attr("fill", (d) => d.color)
    .attr("stroke", "#f1f5f9").attr("stroke-width", 1.5)
    .attr("opacity", (d) => d.level === 0 ? 1 : d.level === 1 ? 0.85 : 0.65)
    .attr("cursor", "pointer")
    .call(d3.drag<SVGCircleElement, SimNode>()
      .on("start", (e, d) => { if (!e.active) simulation.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y; })
      .on("drag", (e, d) => { d.fx = e.x; d.fy = e.y; })
      .on("end", (e, d) => { if (!e.active) simulation.alphaTarget(0); d.fx = null; d.fy = null; })
    );

  // 7. 绘制文字标签：显示在节点上方，字号和粗细按层级区分，禁用鼠标事件避免干扰交互
  const label = g.append("g").selectAll("text").data(nodes).join("text")
    .text((d) => d.id)
    .attr("font-size", (d) => d.level === 0 ? 13 : d.level === 1 ? 10 : 8)
    .attr("fill", (d) => d.level === 0 ? "#1e293b" : "#475569")
    .attr("font-weight", (d) => d.level === 0 ? "600" : "400")
    .attr("text-anchor", "middle")
    .attr("dy", (d) => -(getRadius(d.level) + 6))
    .attr("pointer-events", "none");

  // 8. 创建悬浮提示框（DOM div），初始透明，跟随鼠标定位
  const tooltip = d3.select(container).append("div")
    .style("position", "absolute").style("background", "#ffffff").style("border", "1px solid #e2e8f0")
    .style("border-radius", "8px").style("padding", "10px 14px").style("font-size", "13px")
    .style("pointer-events", "none").style("opacity", "0").style("z-index", "20").style("max-width", "280px")
    .style("color", "#334155").style("transition", "opacity 0.15s").style("box-shadow", "0 2px 8px rgba(0,0,0,0.08)");

  // 9. 节点 hover 交互：收集关联节点名称，构建 tooltip HTML，加粗描边高亮当前节点
  node.on("mouseover", function (e, d) {
    const relatedNames: string[] = [];
    links.forEach((l) => {
      if (l.type !== "related") return;
      const s = typeof l.source === "object" ? (l.source as SimNode).id : (l.source as string);
      const t = typeof l.target === "object" ? (l.target as SimNode).id : (l.target as string);
      if (s === d.id) relatedNames.push(t);
      if (t === d.id) relatedNames.push(s);
    });
    let html = `<div style="font-weight:600;color:#1e293b;margin-bottom:4px">${d.id}</div>`;
    html += d.parent
      ? `<div style="color:#64748b;font-size:12px">父节点: ${d.parent} | 分类: ${d.category}</div>`
      : `<div style="color:#64748b;font-size:12px">一级分类</div>`;
    if (relatedNames.length) html += `<div style="color:#0891b2;font-size:12px;margin-top:4px">关联: ${relatedNames.join(", ")}</div>`;
    tooltip.html(html).style("opacity", "1").style("left", `${e.offsetX + 12}px`).style("top", `${e.offsetY - 10}px`);
    d3.select(this).attr("stroke", "#334155").attr("stroke-width", 3);
  }).on("mousemove", function (e) {
    // 跟随鼠标移动更新 tooltip 位置
    tooltip.style("left", `${e.offsetX + 12}px`).style("top", `${e.offsetY - 10}px`);
  }).on("mouseout", function () {
    // 鼠标移出时隐藏 tooltip，恢复节点描边
    tooltip.style("opacity", "0");
    d3.select(this).attr("stroke", "#f1f5f9").attr("stroke-width", 1.5);
  });

  // 10. 点击高亮：点击节点后只高亮该节点及其直接相连节点，其余淡化
  //     再次点击同一节点或点击空白区域取消高亮
  let selectedId: string | null = null;
  node.on("click", function (e, d) {
    e.stopPropagation();
    if (selectedId === d.id) { selectedId = null; resetHighlight(); return; }
    selectedId = d.id;
    const connected = new Set([d.id]);
    links.forEach((l) => {
      const s = typeof l.source === "object" ? (l.source as SimNode).id : (l.source as string);
      const t = typeof l.target === "object" ? (l.target as SimNode).id : (l.target as string);
      if (s === d.id) connected.add(t);
      if (t === d.id) connected.add(s);
    });
    node.attr("opacity", (n) => connected.has(n.id) ? 1 : 0.08);
    link.attr("opacity", (l) => {
      const s = typeof l.source === "object" ? (l.source as SimNode).id : (l.source as string);
      const t = typeof l.target === "object" ? (l.target as SimNode).id : (l.target as string);
      return (s === d.id || t === d.id) ? 0.9 : 0.03;
    });
    label.attr("opacity", (n) => connected.has(n.id) ? 1 : 0);
  });
  svg.on("click", () => { selectedId = null; resetHighlight(); });

  // 恢复所有节点、连线、标签到默认透明度
  function resetHighlight() {
    node.attr("opacity", (d) => d.level === 0 ? 1 : d.level === 1 ? 0.85 : 0.65);
    link.attr("opacity", 0.6);
    label.attr("opacity", 1);
  }

  // 11. 每帧 tick 回调：根据模拟计算的坐标更新连线端点、节点位置、标签位置
  simulation.on("tick", () => {
    link
      .attr("x1", (d) => (d.source as SimNode).x!)
      .attr("y1", (d) => (d.source as SimNode).y!)
      .attr("x2", (d) => (d.target as SimNode).x!)
      .attr("y2", (d) => (d.target as SimNode).y!);
    node.attr("cx", (d) => d.x!).attr("cy", (d) => d.y!);
    label.attr("x", (d) => d.x!).attr("y", (d) => d.y!);
  });
}
