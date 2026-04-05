"use client";

import { useState, useCallback } from "react";
import { useRuntimeConfig } from "../../components/runtime-config";
import type { SimNode } from "./graph-shared";
import Graph2D from "./graph-2d";
import Graph3D from "./graph-3d";

type Mode = "2d" | "3d";

export default function GraphPage() {
  const { apiBase } = useRuntimeConfig();
  const [mode, setMode] = useState<Mode>("2d");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState({ nodes: 0, edges: 0 });
  const [legend, setLegend] = useState<Record<string, string>>({});
  const [hovered, setHovered] = useState<SimNode | null>(null);

  const handleStats = useCallback((s: { nodes: number; edges: number }) => {
    setStats(s);
    setLoading(false);
    setError(null);
  }, []);
  const handleLegend = useCallback((l: Record<string, string>) => setLegend(l), []);
  const handleHover = useCallback((n: SimNode | null) => setHovered(n), []);

  const hint = mode === "3d" ? "拖拽旋转 / 滚轮缩放 / 点击高亮" : "拖拽节点 / 滚轮缩放 / 点击高亮";

  return (
    <div className="relative h-[calc(100vh-57px)] w-full overflow-hidden bg-slate-100">
      <div className="absolute top-5 left-5 z-10">
        <h1 className="text-lg font-semibold text-slate-800">前端知识图谱</h1>
        <p className="mt-1 text-xs text-slate-500">
          {loading ? "加载中..." : error ? error : `${stats.nodes} 节点 · ${stats.edges} 条边 | ${hint}`}
        </p>
      </div>

      {/* 2D/3D 切换 */}
      <div className="absolute top-5 right-5 z-10 flex rounded-lg border border-slate-200 bg-white/90 shadow-sm text-xs overflow-hidden">
        <button
          onClick={() => setMode("2d")}
          className={`px-3 py-1.5 transition-colors ${mode === "2d" ? "bg-slate-800 text-white" : "text-slate-600 hover:bg-slate-100"}`}
        >
          2D
        </button>
        <button
          onClick={() => setMode("3d")}
          className={`px-3 py-1.5 transition-colors ${mode === "3d" ? "bg-slate-800 text-white" : "text-slate-600 hover:bg-slate-100"}`}
        >
          3D
        </button>
      </div>

      {/* hover 信息 */}
      {hovered && (
        <div className="absolute top-16 right-5 z-10 rounded-lg border border-slate-200 bg-white/90 px-4 py-3 shadow-sm text-sm text-slate-700">
          <div className="font-semibold text-slate-900">{hovered.id}</div>
          <div className="text-xs text-slate-500 mt-1">
            {hovered.parent ? `父节点: ${hovered.parent} | 分类: ${hovered.category}` : "一级分类"}
          </div>
        </div>
      )}

      {/* 图例 */}
      <div className="absolute bottom-5 left-5 z-10 rounded-lg border border-slate-200 bg-white/90 px-4 py-3 shadow-sm max-h-[50vh] overflow-y-auto">
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

      {/* 图谱渲染 */}
      {mode === "3d" ? (
        <Graph3D apiBase={apiBase} onStats={handleStats} onLegend={handleLegend} onHover={handleHover} />
      ) : (
        <Graph2D apiBase={apiBase} onStats={handleStats} onLegend={handleLegend} onHover={handleHover} />
      )}
    </div>
  );
}