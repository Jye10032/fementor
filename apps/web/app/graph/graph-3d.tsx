"use client";

import { useEffect, useRef } from "react";
import { apiRequest } from "../../lib/api";
import { buildD3Data, GraphData, GraphComponentProps } from "./graph-shared";

export default function Graph3D({ apiBase, onStats, onLegend, onHover }: GraphComponentProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const graphRef = useRef<any>(null);

  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let graph: any = null;

    async function load() {
      try {
        const [ForceGraph3DModule, data] = await Promise.all([
          import("3d-force-graph"),
          apiRequest<{ graph: GraphData }>(apiBase, "/v1/knowledge-graph", { auth: "none" }),
        ]);
        if (cancelled || !containerRef.current) return;

        const ForceGraph3D = ForceGraph3DModule.default;
        const { nodes, links, categoryColors } = buildD3Data(data.graph);
        onStats({ nodes: nodes.length, edges: links.length });
        onLegend(categoryColors);

        const adjacency = new Map<string, Set<string>>();
        for (const n of nodes) adjacency.set(n.id, new Set());
        for (const l of links) {
          adjacency.get(l.source as string)?.add(l.target as string);
          adjacency.get(l.target as string)?.add(l.source as string);
        }

        let selectedId: string | null = null;
        let connectedSet: Set<string> | null = null;

        const SpriteText = (await import("three-spritetext")).default;
        const THREE = await import("three");
        const getNodeRadius = (level: number) => level === 0 ? 6 : level === 1 ? 3.5 : 2;

        // PLACEHOLDER_3D_REST

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        graph = new ForceGraph3D(containerRef.current as any)
          .graphData({ nodes: nodes as any[], links: links as any[] })
          .nodeId("id")
          .backgroundColor("#f1f5f9")
          .nodeVal((n: any) => n.level === 0 ? 12 : n.level === 1 ? 4 : 1.5)
          .nodeThreeObject((n: any) => {
            const group = new THREE.Group();
            const r = getNodeRadius(n.level);
            const geometry = new THREE.SphereGeometry(r, 16, 12);
            const baseColor = (!connectedSet || connectedSet.has(n.id)) ? n.color : "#cbd5e1";
            const material = new THREE.MeshLambertMaterial({
              color: baseColor, transparent: true, opacity: 0.9,
            });
            group.add(new THREE.Mesh(geometry, material));
            const sprite = new SpriteText(n.id) as any;
            sprite.color = n.level === 0 ? "#1e293b" : "#64748b";
            sprite.textHeight = n.level === 0 ? 4 : n.level === 1 ? 2.5 : 1.8;
            sprite.backgroundColor = "rgba(255,255,255,0.75)";
            sprite.borderRadius = 2;
            sprite.padding = [1, 2];
            sprite.position.y = r + (n.level === 0 ? 5 : 3.5);
            group.add(sprite);
            return group;
          })
          .linkColor((l: any) => {
            if (!connectedSet) return l.type === "parent" ? "#94a3b8" : "#cbd5e1";
            const s = typeof l.source === "object" ? l.source.id : l.source;
            const t = typeof l.target === "object" ? l.target.id : l.target;
            if (connectedSet.has(s) && connectedSet.has(t)) {
              return l.type === "parent" ? "#94a3b8" : "#cbd5e1";
            }
            return "rgba(203,213,225,0.06)";
          })
          .linkWidth((l: any) => l.type === "parent" ? 1.2 : 0.4)
          .linkOpacity(0.7)
          .onNodeHover((node: any) => {
            onHover(node);
            if (containerRef.current) {
              containerRef.current.style.cursor = node ? "pointer" : "default";
            }
          })
          .onNodeClick((node: any) => {
            if (selectedId === node.id) {
              selectedId = null;
              connectedSet = null;
            } else {
              selectedId = node.id;
              connectedSet = new Set([node.id, ...(adjacency.get(node.id) || [])]);
            }
            graph!.nodeColor(graph!.nodeColor());
            graph!.linkColor(graph!.linkColor());
          })
          .onBackgroundClick(() => {
            selectedId = null;
            connectedSet = null;
            graph!.nodeColor(graph!.nodeColor());
            graph!.linkColor(graph!.linkColor());
          })
          .warmupTicks(80)
          .cooldownTime(3000);

        graph.d3Force("charge")?.strength((n: any) => n.level === 0 ? -300 : n.level === 1 ? -80 : -30);
        const linkForce = graph.d3Force("link");
        if (linkForce) {
          linkForce.id((d: any) => d.id);
          linkForce.distance((l: any) => l.type === "parent" ? 40 : 70);
          linkForce.strength((l: any) => l.type === "parent" ? 0.7 : 0.1);
        }

        graphRef.current = graph;
        setTimeout(() => graph?.zoomToFit(400, 60), 500);
      } catch {
        // errors handled by parent
      }
    }

    void load();
    return () => {
      cancelled = true;
      if (graphRef.current) {
        graphRef.current.pauseAnimation();
        graphRef.current._destructor?.();
        graphRef.current = null;
      }
      if (containerRef.current) containerRef.current.innerHTML = "";
    };
  }, [apiBase, onStats, onLegend, onHover]);

  return <div ref={containerRef} className="h-full w-full" />;
}
