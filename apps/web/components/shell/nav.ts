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

export const NAV: NavItem[] = [
  { title: "Overview", href: "/", icon: LayoutDashboard },
  { title: "Prompts", href: "/prompts", icon: Coins },
  { title: "Sessions", href: "/sessions", icon: MessagesSquare },
  { title: "Projects", href: "/projects", icon: FolderGit2 },
  { title: "Tools", href: "/tools", icon: Wrench },
  { title: "Skills", href: "/skills", icon: Sparkles },
  { title: "Subagents", href: "/subagents", icon: Network },
  { title: "Workspaces", href: "/workspaces", icon: Boxes },
  { title: "Tips", href: "/tips", icon: Lightbulb },
  { title: "Settings", href: "/settings", icon: Settings },
];
