// Shapes returned by the Rust /api/* surface (see specs/.../contracts/api.md).

export interface Totals {
  sessions: number;
  turns: number;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_create_5m_tokens: number;
  cache_create_1h_tokens: number;
  cost_usd: number | null;
  cost_estimated: boolean;
}

export interface DailyRow {
  day: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_create_tokens: number;
}

export interface ModelRow {
  model: string | null;
  turns: number;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cost_usd: number | null;
  cost_estimated: boolean;
}

export interface ProjectRow {
  project_slug: string;
  sample_cwd: string | null;
  sessions: number;
  turns: number;
  input_tokens: number;
  output_tokens: number;
  billable_tokens: number;
  cache_read_tokens: number;
}

export interface ToolRow {
  tool_name: string;
  calls: number;
  result_tokens: number;
}

export interface SessionRow {
  session_id: string;
  project_slug: string | null;
  sample_cwd: string | null;
  started: string | null;
  ended: string | null;
  turns: number;
  tokens: number;
  cost_usd: number | null;
  cost_estimated: boolean;
}

export interface MessageDetail {
  uuid: string;
  parent_uuid: string | null;
  type: string;
  timestamp: string;
  model: string | null;
  is_sidechain: boolean;
  agent_id: string | null;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_create_5m_tokens: number;
  cache_create_1h_tokens: number;
  prompt_text: string | null;
  prompt_chars: number | null;
  tool_calls_json: string | null;
  project_slug: string;
  cwd: string | null;
}

export interface PromptRow {
  user_uuid: string;
  session_id: string;
  project_slug: string;
  timestamp: string;
  prompt_text: string | null;
  prompt_chars: number | null;
  model: string | null;
  billable_tokens: number;
  cache_read_tokens: number;
  estimated_cost_usd: number | null;
  cost_estimated: boolean;
}

export interface OverviewBundle {
  totals: Totals;
  projects: ProjectRow[];
  sessions: SessionRow[];
  tools: ToolRow[];
  daily: DailyRow[];
  byModel: ModelRow[];
}

export interface RtkInfo {
  available: boolean;
  install_url: string;
  summary: unknown;
  daily: unknown[];
  weekly: unknown[];
  monthly: unknown[];
}

export interface SettingsInfo {
  claude_dir: string;
  projects_dir: string;
  projects_overridden: boolean;
  claude_dirs: string[];
  plan: string;
}

export interface SkillRow {
  skill: string;
  manual_sessions: number;
  tool_invocations: number;
  sessions: number;
  last_used: string | null;
}

export interface AgentGroupRow {
  group: string;
  model: string | null;
  messages: number;
  sessions: number;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cost_usd: number | null;
  cost_estimated: boolean;
}

export interface SubagentsResponse {
  by_kind: AgentGroupRow[];
  by_entrypoint: AgentGroupRow[];
}

export interface WorkspaceRow {
  workspace: string;
  calls: number;
  files: number;
}

export interface Tip {
  key: string;
  category: string;
  severity: string;
  title: string;
  body: string;
}
