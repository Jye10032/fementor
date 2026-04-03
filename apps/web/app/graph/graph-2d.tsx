"use client";

import { useEffect, useRef } from "react";
import * as d3 from "d3";
import { apiRequest } from "../../lib/api";
import { buildD3Data, GraphData, SimNode, SimLink, GraphComponentProps } from "./graph-shared";

function getRadius(level: number) {
  return level === 0 ? 20 : level === 1 ? 10 : 6;
}

export default function Graph2D({ apiBase, onStats, onLegend, onHover }: GraphComponentProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const simulationRef = useRef<d3.Simulation<SimNode, SimLink> | null>(null);

  useEffect(() => {
    let cancelled = false;
    let cleanupResize: (() => void) | undefined;

    async function load() {
      try {
        const data = await apiRequest<{ graph: GraphData }>(apiBase, "/v1/knowledge-graph", { auth: "none" });
        if (cancelled || !containerRef.current) return;
        const { nodes, links, categoryColors } = buildD3Data(data.graph);
        onStats({ nodes: nodes.length, edges: links.length });
        onLegend(categoryColors);
        cleanupResize = renderGraph(containerRef.current, nodes, links, simulationRef, onHover);
      } catch {
        // errors handled by parent
      }
    }

    void load();
    return () => {
      cancelled = true;
      simulationRef.current?.stop();
      cleanupResize?.();
      if (containerRef.current) containerRef.current.innerHTML = "";
    };
  }, [apiBase, onStats, onLegend, onHover]);

  return <div ref={containerRef} className="h-full w-full" />;
}

// PLACEHOLDER_RENDER_GRAPH

function renderGraph(
  container: HTMLDivElement,
  nodes: SimNode[],
  links: SimLink[],
  simulationRef: React.MutableRefObject<d3.Simulation<SimNode, SimLink> | null>,
  onHover: (node: SimNode | null) => void,
): (() => void) {
  container.innerHTML = "";
  let width = container.clientWidth;
  let height = container.clientHeight;
  const dpr = window.devicePixelRatio || 1;

  const canvas = document.createElement("canvas");
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  container.appendChild(canvas);

  const ctx = canvas.getContext("2d")!;
  ctx.scale(dpr, dpr);

  const tooltipEl = document.createElement("div");
  Object.assign(tooltipEl.style, {
    position: "absolute", background: "#ffffff", border: "1px solid #e2e8f0",
    borderRadius: "8px", padding: "10px 14px", fontSize: "13px",
    pointerEvents: "none", opacity: "0", zIndex: "20", maxWidth: "280px",
    color: "#334155", transition: "opacity 0.15s", boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
  });
  container.appendChild(tooltipEl);

  let transform = d3.zoomIdentity;

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

  // PLACEHOLDER_2D_INTERACTION

  let hoveredNode: SimNode | null = null;
  let selectedId: string | null = null;
  let connectedSet: Set<string> | null = null;

  const simulation = d3.forceSimulation<SimNode>(nodes)
    .alphaDecay(0.05)
    .force("link", d3.forceLink<SimNode, SimLink>(links).id((d) => d.id).distance((d) => d.type === "parent" ? 60 : 100).strength((d) => d.type === "parent" ? 0.8 : 0.15))
    .force("charge", d3.forceManyBody<SimNode>().strength((d) => d.level === 0 ? -600 : d.level === 1 ? -200 : -80))
    .force("center", d3.forceCenter(width / 2, height / 2))
    .force("collision", d3.forceCollide<SimNode>().radius((d) => getRadius(d.level) + 8));

  simulationRef.current = simulation;

  function draw() {
    ctx.save();
    ctx.clearRect(0, 0, width, height);
    ctx.translate(transform.x, transform.y);
    ctx.scale(transform.k, transform.k);

    for (const l of links) {
      const s = l.source as SimNode;
      const t = l.target as SimNode;
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

    for (const n of nodes) {
      const r = getRadius(n.level);
      let alpha = n.level === 0 ? 1 : n.level === 1 ? 0.85 : 0.65;
      if (connectedSet) alpha = connectedSet.has(n.id) ? 1 : 0.08;
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      ctx.arc(n.x!, n.y!, r, 0, Math.PI * 2);
      ctx.fillStyle = n.color;
      ctx.fill();
      ctx.strokeStyle = hoveredNode === n ? "#334155" : "#f1f5f9";
      ctx.lineWidth = hoveredNode === n ? 3 : 1.5;
      ctx.stroke();
    }

    // PLACEHOLDER_2D_LABELS

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

  simulation.on("tick", draw);

  function hitTest(mx: number, my: number): SimNode | null {
    const [sx, sy] = transform.invert([mx, my]);
    for (let i = nodes.length - 1; i >= 0; i--) {
      const n = nodes[i];
      const dx = sx - n.x!;
      const dy = sy - n.y!;
      if (dx * dx + dy * dy < (getRadius(n.level) + 4) ** 2) return n;
    }
    return null;
  }

  let dragNode: SimNode | null = null;
  const zoomBehavior = d3.zoom<HTMLCanvasElement, unknown>()
    .scaleExtent([0.2, 4])
    .filter((e) => {
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

  let dragStartX = 0;
  let dragStartY = 0;

  // PLACEHOLDER_2D_EVENTS

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

  canvas.addEventListener("mousemove", (e) => {
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const hit = hitTest(mx, my);

    if (hit !== hoveredNode) {
      hoveredNode = hit;
      canvas.style.cursor = hit ? "pointer" : "default";
      onHover(hit);
      draw();
    }

    // PLACEHOLDER_2D_TOOLTIP

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
    onHover(null);
    tooltipEl.style.opacity = "0";
    draw();
  });

  canvas.addEventListener("click", (e) => {
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

  const resizeObserver = new ResizeObserver(() => {
    const newWidth = container.clientWidth;
    const newHeight = container.clientHeight;
    if (newWidth === width && newHeight === height) return;
    width = newWidth;
    height = newHeight;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    simulation.force("center", d3.forceCenter(width / 2, height / 2));
    simulation.alpha(0.1).restart();
  });
  resizeObserver.observe(container);

  return () => resizeObserver.disconnect();
}




