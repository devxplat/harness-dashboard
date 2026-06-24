"use client";

import type { ComponentType } from "react";

export type ProviderId =
  | "claude"
  | "codex"
  | "gemini"
  | "cursor"
  | "antigravity"
  | "copilot"
  | "opencode";

type ProviderIconProps = {
  className?: string;
};

type ProviderMeta = {
  id: ProviderId;
  label: string;
  shortLabel: string;
  color: string;
  bg: string;
  border: string;
  Icon: ComponentType<ProviderIconProps>;
};

function ProviderLogo({
  src,
  alt,
  className,
}: {
  src: string;
  alt: string;
  className?: string;
}) {
  return (
    <img
      src={src}
      alt={alt}
      className={className}
      draggable={false}
      decoding="async"
    />
  );
}

function ClaudeIcon(props: ProviderIconProps) {
  return <ProviderLogo src="/provider-logos/claude.svg" alt="Claude" {...props} />;
}

function OpenAIIcon(props: ProviderIconProps) {
  return <ProviderLogo src="/provider-logos/openai.svg" alt="OpenAI" {...props} />;
}

function GeminiIcon(props: ProviderIconProps) {
  return <ProviderLogo src="/provider-logos/gemini.svg" alt="Gemini" {...props} />;
}

function CursorIcon(props: ProviderIconProps) {
  return <ProviderLogo src="/provider-logos/cursor.svg" alt="Cursor" {...props} />;
}

function AntigravityIcon(props: ProviderIconProps) {
  return <ProviderLogo src="/provider-logos/antigravity.png" alt="Google Antigravity" {...props} />;
}

function CopilotIcon(props: ProviderIconProps) {
  return <ProviderLogo src="/provider-logos/copilot.svg" alt="GitHub Copilot" {...props} />;
}

function OpencodeIcon(props: ProviderIconProps) {
  return <ProviderLogo src="/provider-logos/opencode.svg" alt="opencode" {...props} />;
}

export const PROVIDERS: ProviderMeta[] = [
  {
    id: "claude",
    label: "Claude Code",
    shortLabel: "Claude",
    color: "#d97757",
    bg: "rgba(217,119,87,0.12)",
    border: "rgba(217,119,87,0.35)",
    Icon: ClaudeIcon,
  },
  {
    id: "codex",
    label: "Codex",
    shortLabel: "Codex",
    color: "#111111",
    bg: "rgba(17,17,17,0.08)",
    border: "rgba(17,17,17,0.22)",
    Icon: OpenAIIcon,
  },
  {
    id: "gemini",
    label: "Gemini CLI",
    shortLabel: "Gemini",
    color: "#4285f4",
    bg: "rgba(66,133,244,0.12)",
    border: "rgba(66,133,244,0.35)",
    Icon: GeminiIcon,
  },
  {
    id: "cursor",
    label: "Cursor",
    shortLabel: "Cursor",
    color: "#26241e",
    bg: "rgba(38,36,30,0.09)",
    border: "rgba(38,36,30,0.25)",
    Icon: CursorIcon,
  },
  {
    id: "antigravity",
    label: "Antigravity",
    shortLabel: "AG",
    color: "#1a73e8",
    bg: "rgba(26,115,232,0.12)",
    border: "rgba(26,115,232,0.35)",
    Icon: AntigravityIcon,
  },
  {
    id: "copilot",
    label: "GitHub Copilot",
    shortLabel: "Copilot",
    color: "#8534f3",
    bg: "rgba(133,52,243,0.12)",
    border: "rgba(133,52,243,0.35)",
    Icon: CopilotIcon,
  },
  {
    id: "opencode",
    label: "opencode",
    shortLabel: "opencode",
    color: "#242121",
    bg: "rgba(36,33,33,0.09)",
    border: "rgba(36,33,33,0.24)",
    Icon: OpencodeIcon,
  },
];

export const PROVIDER_IDS = PROVIDERS.map((p) => p.id);

export function providerMeta(id: string | null | undefined): ProviderMeta {
  return PROVIDERS.find((p) => p.id === id) ?? PROVIDERS[0]!;
}
