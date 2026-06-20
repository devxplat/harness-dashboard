"use client";

import { useApi } from "@/hooks/use-api";
import type { RtkInfo } from "@/lib/types";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { Activity, Zap } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV } from "./nav";

function norm(p: string): string {
  return p !== "/" && p.endsWith("/") ? p.slice(0, -1) : p;
}

export function AppSidebar() {
  const pathname = norm(usePathname() ?? "/");
  const { data: rtk } = useApi<RtkInfo>("/api/rtk");

  return (
    <Sidebar>
      <SidebarHeader className="px-3 py-3">
        <div className="flex items-center gap-2 text-base font-semibold">
          <Activity className="size-5 text-primary" />
          <span>harness</span>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {NAV.map((item) => (
                <SidebarMenuItem key={item.href}>
                  <SidebarMenuButton asChild isActive={pathname === norm(item.href)} tooltip={item.title}>
                    <Link href={item.href}>
                      <item.icon />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
              {rtk?.available ? (
                <SidebarMenuItem>
                  <SidebarMenuButton asChild isActive={pathname === "/rtk"} tooltip="RTK">
                    <Link href="/rtk">
                      <Zap />
                      <span>RTK</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ) : null}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}
