"use client";

import { GitBranch, Upload, Globe, FolderOpen, Layers, BarChart2, Eye, GitCompare } from "lucide-react";

interface WelcomeScreenProps {
  onLoadChart: () => void;
}

const FEATURES = [
  {
    icon: FolderOpen,
    color: "text-blue-400",
    bg: "bg-blue-950/40 border-blue-800/50",
    title: "Workspace Charts",
    desc: "Instantly visualize the Helm chart in your current repo — no CLI needed.",
  },
  {
    icon: Upload,
    color: "text-green-400",
    bg: "bg-green-950/40 border-green-800/50",
    title: "Upload .tgz",
    desc: "Drag-and-drop any packaged Helm chart and see its full resource graph.",
  },
  {
    icon: Globe,
    color: "text-yellow-400",
    bg: "bg-yellow-950/40 border-yellow-800/50",
    title: "Artifact Hub",
    desc: "Search and load public charts from Artifact Hub — including OCI registries.",
  },
  {
    icon: GitCompare,
    color: "text-purple-400",
    bg: "bg-purple-950/40 border-purple-800/50",
    title: "Env Diff",
    desc: "Compare two environments side-by-side. Changed nodes glow in amber.",
  },
  {
    icon: Layers,
    color: "text-teal-400",
    bg: "bg-teal-950/40 border-teal-800/50",
    title: "Multi-Environment",
    desc: "Switch between dev / sit / uat / prd — each rendered from its own values file.",
  },
  {
    icon: Eye,
    color: "text-orange-400",
    bg: "bg-orange-950/40 border-orange-800/50",
    title: "Values Inspector",
    desc: "Explore every value in context. Hover to highlight where it's used.",
  },
  {
    icon: BarChart2,
    color: "text-red-400",
    bg: "bg-red-950/40 border-red-800/50",
    title: "Resource Stats",
    desc: "Kind-level badges in the header give you an at-a-glance inventory.",
  },
  {
    icon: GitBranch,
    color: "text-indigo-400",
    bg: "bg-indigo-950/40 border-indigo-800/50",
    title: "Pure JS Engine",
    desc: "Go template rendering runs 100% in-browser — no Helm CLI installation required.",
  },
];

export function WelcomeScreen({ onLoadChart }: WelcomeScreenProps) {
  return (
    <div className="flex flex-col items-center justify-center h-full px-8 py-12 overflow-y-auto">
      {/* Hero */}
      <div className="flex flex-col items-center text-center mb-10 max-w-xl">
        <div className="w-16 h-16 rounded-2xl bg-blue-600/20 border border-blue-500/30 flex items-center justify-center mb-5">
          <GitBranch className="w-8 h-8 text-blue-400" />
        </div>
        <h1 className="text-3xl font-bold text-white mb-3">Helm Chart Visualizer</h1>
        <p className="text-zinc-400 text-base leading-relaxed">
          Render, explore, and diff Kubernetes resources from any Helm chart — right in your browser.
          No Helm CLI. No cluster access required.
        </p>
        <button
          onClick={onLoadChart}
          className="mt-6 bg-blue-600 hover:bg-blue-500 text-white font-semibold px-6 py-2.5 rounded-xl text-sm transition-colors shadow-lg shadow-blue-900/40"
        >
          Load a Chart to Get Started
        </button>
      </div>

      {/* Feature grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 w-full max-w-3xl">
        {FEATURES.map(({ icon: Icon, color, bg, title, desc }) => (
          <div
            key={title}
            className={`rounded-xl border p-4 flex flex-col gap-2 ${bg}`}
          >
            <Icon className={`w-5 h-5 ${color}`} />
            <div>
              <div className="text-white text-xs font-semibold mb-0.5">{title}</div>
              <div className="text-zinc-400 text-[11px] leading-snug">{desc}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
