import type { LucideIcon } from "lucide-react";
import {
  Boxes,
  Coins,
  FolderGit2,
  LayoutDashboard,
  Lightbulb,
  MessagesSquare,
  Network,
  Settings,
  Sparkles,
  Wrench,
} from "lucide-react";

export interface NavItem {
  title: string;
  href: string;
  icon: LucideIcon;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    label: "Usage",
    items: [
      { title: "Overview", href: "/", icon: LayoutDashboard },
      { title: "Prompts", href: "/prompts", icon: Coins },
      { title: "Sessions", href: "/sessions", icon: MessagesSquare },
      { title: "Projects", href: "/projects", icon: FolderGit2 },
    ],
  },
  {
    label: "Tools & agents",
    items: [
      { title: "Tools", href: "/tools", icon: Wrench },
      { title: "Skills", href: "/skills", icon: Sparkles },
      { title: "Subagents", href: "/subagents", icon: Network },
      { title: "Workspaces", href: "/workspaces", icon: Boxes },
    ],
  },
  {
    label: "More",
    items: [
      { title: "Tips", href: "/tips", icon: Lightbulb },
      { title: "Settings", href: "/settings", icon: Settings },
    ],
  },
];

/** Flat list of every nav item (kept for consumers that don't need groups). */
export const NAV: NavItem[] = NAV_GROUPS.flatMap((g) => g.items);
