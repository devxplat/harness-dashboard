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
  reported_cost_usd: number | null;
}

export interface DailyRow {
  provider: string;
  day: string;
  sessions: number;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_create_tokens: number;
}

export interface ActivityBucket {
  provider: string;
  key: string;
  day: string;
  half: string;
  sessions: number;
  input_tokens: number;
  output_tokens: number;
  cache_create_tokens: number;
}

export interface ModelRow {
  provider: string;
  model: string | null;
  turns: number;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cost_usd: number | null;
  cost_estimated: boolean;
}

export interface ProjectRow {
  provider: string;
  providers?: string[];
  project_slug: string;
  repo_key?: string | null;
  repo_root?: string | null;
  sample_cwd: string | null;
  sessions: number;
  turns: number;
  input_tokens: number;
  output_tokens: number;
  billable_tokens: number;
  cache_read_tokens: number;
}

export interface ToolRow {
  provider: string;
  tool_name: string;
  calls: number;
  result_tokens: number;
}

export interface SessionRow {
  provider: string;
  session_id: string;
  project_slug: string | null;
  sample_cwd: string | null;
  started: string | null;
  ended: string | null;
  turns: number;
  tokens: number;
  cost_usd: number | null;
  cost_estimated: boolean;
  reported_cost_usd: number | null;
}

export interface MessageDetail {
  provider: string;
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
  usage_source: string;
  reported_cost_usd: number | null;
  cost_source: string;
  prompt_text: string | null;
  prompt_chars: number | null;
  tool_calls_json: string | null;
  project_slug: string;
  cwd: string | null;
}

export interface PromptRow {
  provider: string;
  user_uuid: string;
  session_id: string;
  project_slug: string;
  sample_cwd: string | null;
  timestamp: string;
  prompt_text: string | null;
  prompt_chars: number | null;
  model: string | null;
  billable_tokens: number;
  cache_read_tokens: number;
  estimated_cost_usd: number | null;
  cost_estimated: boolean;
  reported_cost_usd: number | null;
}

export interface ProviderSummary {
  provider: string;
  label: string;
  sessions: number;
  messages: number;
  turns: number;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_create_tokens: number;
  cost_usd: number | null;
  reported_cost_usd: number | null;
  tokens_available: boolean;
  cost_available: boolean;
}

/** Per-day commit counts (AI / human split + churn). `day` aligns with DailyRow.day. */
export interface CommitDailyRow {
  day: string;
  commits: number;
  ai_commits: number;
  human_commits: number;
  insertions: number;
  deletions: number;
}

/** AI-vs-human commit counts grouped by day or project slug. */
export interface AiSplitRow {
  key: string;
  ai_commits: number;
  human_commits: number;
}

/** One cell of the dense 7×24 productive-hours matrix (local weekday × hour). */
export interface ProductiveHourRow {
  dow: number; // 0=Sunday..6=Saturday
  hour: number; // 0..23
  commits: number;
  messages: number;
}

export interface CommitRow {
  sha: string;
  repo_key: string;
  project_slug: string | null;
  sample_cwd: string | null;
  author_name: string | null;
  author_email: string | null;
  authored_at_utc: string;
  authored_at_local: string | null;
  subject: string | null;
  branch: string | null;
  files_changed: number;
  insertions: number;
  deletions: number;
  is_merge: boolean;
  ai_assisted: boolean;
  ai_session_overlap: boolean;
  ai_coauthor_trailer: boolean;
  coauthors: string[];
}

/** The /api/productivity response. */
export interface ProductivityBundle {
  hours: ProductiveHourRow[];
  aiByDay: AiSplitRow[];
  aiByProject: AiSplitRow[];
}

/** Per-day busy-meeting count + minutes (calendar overlay). `day` aligns with DailyRow.day. */
export interface MeetingDay {
  day: string;
  count: number;
  minutes: number;
}

/** Coding output during vs free of busy meetings. */
export interface MeetingImpact {
  during_commits: number;
  free_commits: number;
  during_messages: number;
  free_messages: number;
}

export interface OverviewBundle {
  totals: Totals;
  projects: ProjectRow[];
  sessions: SessionRow[];
  tools: ToolRow[];
  daily: DailyRow[];
  activity: ActivityBucket[];
  providers: ProviderSummary[];
  byModel: ModelRow[];
  commitsDaily: CommitDailyRow[];
  productivity: ProductiveHourRow[];
  meetingsDaily: MeetingDay[];
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
  providers: ProviderConfig[];
  /** Whether the first-run onboarding wizard has been completed. */
  onboarding_done?: boolean;
  /** Last onboarding step the user was on (for resume-where-you-left-off). */
  onboarding_step?: number;
}

/** Whole-app ingest status — drives the data-screen gate and the shared status pill. */
export interface IngestStatus {
  /** Any local sessions indexed yet (message rows > 0). */
  seeded: boolean;
  onboarding_done: boolean;
  /** A local-transcript scan is in flight. */
  scanning: boolean;
  messages: number;
  github: {
    configured: boolean;
    syncing: boolean;
    progress: GithubProgress | null;
  };
}

export interface ProviderConfig {
  id: string;
  label: string;
  enabled: boolean;
  default_path: string;
  configured_path: string | null;
  active_path: string;
  discovered: boolean;
  capabilities: {
    usage?: "exact" | "reported" | "missing" | string;
    tokens: boolean;
    cost?: "estimated" | "reported" | "missing" | string;
    tools: boolean;
    costs: boolean;
    prompts: boolean;
  };
  supported?: ProviderCapabilitySet;
  observed?: ProviderCapabilitySet;
  last_scan_counts: {
    sessions: number;
    messages: number;
    tools: number;
    prompts?: number;
  };
  sources?: ProviderSourceConfig[];
}

export interface ProviderCapabilitySet {
  usage?: "exact" | "reported" | "missing" | string;
  tokens: boolean;
  cost?: "estimated" | "reported" | "missing" | string;
  tools: boolean;
  costs: boolean;
  prompts: boolean;
}

export interface ProviderSourceConfig {
  key: string;
  label: string;
  enabled: boolean;
  env_var?: string | null;
  default_path: string | null;
  configured_path: string | null;
  active_path: string | null;
  discovered: boolean;
  setup_hint?: string | null;
  capabilities: {
    usage?: "exact" | "reported" | "missing" | string;
    tokens: boolean;
    cost?: "estimated" | "reported" | "missing" | string;
    costs: boolean;
    tools: boolean;
    prompts: boolean;
  };
  supported?: ProviderCapabilitySet;
  observed?: ProviderCapabilitySet;
}

/** One DORA metric; `value === null` means "not derivable from configured sources". */
export interface DoraMetric {
  key: string;
  label: string;
  value: number | null;
  unit: string;
  detail: string;
  source: string;
  exact: boolean;
}

export interface GithubRateBudget {
  remaining: number | null;
  limit: number | null;
  reset_utc: string | null;
}

export interface GithubIntegration {
  configured: boolean;
  repo_count: number;
  enabled_repo_count?: number;
  last_sync: string | null;
  login?: string | null;
  scopes?: string[];
  has_repo_scope?: boolean;
  syncing?: boolean;
  rate?: GithubRateBudget | null;
  backfill?: GithubSyncSettings["backfill"];
  autosync?: GithubSyncSettings["autosync"];
}

export interface IntegrationsInfo {
  github: GithubIntegration;
  google: { configured: boolean; last_sync: string | null };
}

/** One repo in the picker (flat form). */
export interface GithubRepoItem {
  repo_key: string;
  owner: string;
  repo: string;
  primary_slug: string | null;
  enabled: boolean;
  last_synced_at: string | null;
}

/** Repos grouped by owner/org for the picker. */
export interface GithubRepoOrg {
  owner: string;
  repos: GithubRepoItem[];
  enabled_count: number;
  total: number;
}

export interface GithubReposResponse {
  orgs: GithubRepoOrg[];
  total_repos: number;
  enabled_repos: number;
}

/** Backfill window + auto-sync settings (user-controlled). */
export interface GithubSyncSettings {
  backfill: { value: number; unit: "days" | "weeks" | "months" | "all" | "recent" };
  autosync: { enabled: boolean; interval_min: number };
  /** Which PRs to import: every author's (baselines) or only the connected user's. */
  pr_scope?: "all" | "mine";
  backfill_done?: boolean;
}

/** Live sync progress (pushed over SSE + pollable). */
export interface GithubProgress {
  running: boolean;
  repo_index: number;
  repo_total: number;
  current_repo: string | null;
  pull_requests: number;
  deployments: number;
  rate_remaining: number | null;
  rate_limit: number | null;
  rate_reset_utc: string | null;
  last_error: string | null;
  finished_at: string | null;
}

export interface PullRequestRow {
  repo_key: string;
  number: number;
  title: string | null;
  state: string | null; // open | closed | merged
  author: string | null;
  created_at_utc: string | null;
  merged_at_utc: string | null;
  head_branch: string | null;
  base_branch: string | null;
  additions: number;
  deletions: number;
  changed_files: number;
  review_count: number;
  html_url: string | null;
  ai_session_overlap: boolean;
}

export interface DeploymentRow {
  repo_key: string;
  kind: string; // tag | release | run
  ext_id: string;
  name: string | null;
  created_at_utc: string | null;
  status: string | null; // success | failure | null
  html_url: string | null;
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
  sample_cwd: string | null;
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
