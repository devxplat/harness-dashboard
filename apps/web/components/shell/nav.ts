import type { LucideIcon } from "lucide-react";
import {
  Activity,
  Boxes,
  BrainCircuit,
  Coins,
  FolderGit2,
  Gauge,
  HeartPulse,
  LayoutDashboard,
  Lightbulb,
  MessagesSquare,
  Network,
  PieChart,
  Settings,
  Sparkles,
  Users,
  Wrench,
} from "lucide-react";

export interface NavItem {
  /** English label (fallback); `key` is the i18n lookup. */
  title: string;
  /** i18n key, e.g. "nav.overview". */
  key: string;
  href: string;
  icon: LucideIcon;
}

export interface NavGroup {
  /** Stable id for logic (e.g. RTK placement); independent of the translated label. */
  id: string;
  label: string;
  /** i18n key, e.g. "nav.groups.usage". */
  key: string;
  items: NavItem[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    id: "usage",
    label: "Usage",
    key: "nav.groups.usage",
    items: [
      { title: "Overview", key: "nav.overview", href: "/", icon: LayoutDashboard },
      { title: "Prompts", key: "nav.prompts", href: "/prompts", icon: Coins },
      { title: "Sessions", key: "nav.sessions", href: "/sessions", icon: MessagesSquare },
      { title: "Projects", key: "nav.projects", href: "/projects", icon: FolderGit2 },
    ],
  },
  {
    id: "tools",
    label: "Tools & agents",
    key: "nav.groups.tools",
    items: [
      { title: "Tools", key: "nav.tools", href: "/tools", icon: Wrench },
      { title: "Skills", key: "nav.skills", href: "/skills", icon: Sparkles },
      { title: "Subagents", key: "nav.subagents", href: "/subagents", icon: Network },
      { title: "Workspaces", key: "nav.workspaces", href: "/workspaces", icon: Boxes },
    ],
  },
  {
    id: "performance",
    label: "Performance",
    key: "nav.groups.performance",
    items: [
      { title: "Productivity", key: "nav.productivity", href: "/productivity", icon: Gauge },
      { title: "AI Impact", key: "nav.aiImpact", href: "/ai-impact", icon: BrainCircuit },
      { title: "DORA", key: "nav.dora", href: "/dora", icon: Activity },
      { title: "Allocation", key: "nav.allocation", href: "/allocation", icon: PieChart },
      { title: "DevEx", key: "nav.devex", href: "/devex", icon: HeartPulse },
      { title: "Team", key: "nav.team", href: "/team", icon: Users },
    ],
  },
  {
    id: "more",
    label: "More",
    key: "nav.groups.more",
    items: [
      { title: "Tips", key: "nav.tips", href: "/tips", icon: Lightbulb },
      { title: "Settings", key: "nav.settings", href: "/settings", icon: Settings },
    ],
  },
];

/** Flat list of every nav item (kept for consumers that don't need groups). */
export const NAV: NavItem[] = NAV_GROUPS.flatMap((g) => g.items);
