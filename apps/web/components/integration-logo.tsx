"use client";

import { cn } from "@/lib/utils";

type IntegrationLogoId = "github" | "google-calendar";

const LOGOS: Record<IntegrationLogoId, { src: string; alt: string; invertOnDark?: boolean }> = {
  github: {
    src: "/integration-logos/github.svg",
    alt: "GitHub logo",
    invertOnDark: true,
  },
  "google-calendar": {
    src: "/integration-logos/google-calendar.svg",
    alt: "Google Calendar logo",
  },
};

export function IntegrationLogo({
  id,
  className,
}: {
  id: IntegrationLogoId;
  className?: string;
}) {
  const logo = LOGOS[id];
  return (
    <img
      src={logo.src}
      alt={logo.alt}
      className={cn("size-5 object-contain", logo.invertOnDark && "dark:invert", className)}
      draggable={false}
      decoding="async"
    />
  );
}
