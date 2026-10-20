use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Clone, Serialize, Deserialize, TS, Default)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub repositories: Vec<String>,
    pub codex_path: Option<String>,
    pub gh_path: Option<String>,
    pub model: Option<String>,
    pub theme: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct Connection {
    pub connected: bool,
    pub identity: String,
    pub executable: String,
    pub detail: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct Model {
    pub id: String,
    pub name: String,
    pub is_default: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct Bootstrap {
    pub settings: Settings,
    pub github: Connection,
    pub codex: Connection,
    pub models: Vec<Model>,
    pub pulls: Vec<PullRequest>,
    pub data_directory: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct Repository {
    pub id: String,
    pub full_name: String,
    pub private: bool,
    pub description: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct PullRequest {
    pub repository: String,
    pub number: u32,
    pub title: String,
    pub body: String,
    pub author: String,
    pub url: String,
    pub draft: bool,
    pub state: String,
    pub head: String,
    pub base: String,
    pub head_ref: String,
    pub base_ref: String,
    pub updated_at: String,
    pub requested: Vec<String>,
    pub assigned: Vec<String>,
    pub additions: u32,
    pub deletions: u32,
    pub changed_files: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum LineKind {
    Context,
    Addition,
    Deletion,
    Meta,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct DiffLine {
    pub kind: LineKind,
    pub old: Option<u32>,
    pub new: Option<u32>,
    pub text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct Hunk {
    pub id: String,
    pub fingerprint: String,
    pub path: String,
    pub header: String,
    pub lines: Vec<DiffLine>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct ChangedFile {
    pub path: String,
    pub previous_path: Option<String>,
    pub status: String,
    pub additions: u32,
    pub deletions: u32,
    pub hunks: Vec<Hunk>,
    pub unavailable: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub id: String,
    pub pull: PullRequest,
    pub captured_at: String,
    pub files: Vec<ChangedFile>,
    pub limitations: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum Attention {
    High,
    NeedsAssessment,
    Standard,
    Routine,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq, Eq)]
pub enum Side {
    LEFT,
    RIGHT,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct Anchor {
    pub hunk_id: String,
    pub path: String,
    pub side: Side,
    pub start_line: u32,
    pub line: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct Finding {
    pub title: String,
    pub body: String,
    pub severity: String,
    pub anchor: Anchor,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct GuideSection {
    pub id: String,
    pub title: String,
    pub summary: String,
    pub attention: Attention,
    pub category: String,
    pub reason: String,
    pub hunk_ids: Vec<String>,
    pub unavailable_paths: Vec<String>,
    pub questions: Vec<String>,
    pub findings: Vec<Finding>,
    pub assessed: bool,
    pub foldable: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct Guide {
    pub snapshot_id: String,
    pub summary: String,
    pub sections: Vec<GuideSection>,
    pub source: String,
    pub model: String,
    pub generated_at: String,
    pub limitations: Vec<String>,
    pub policy_version: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct Note {
    pub id: String,
    pub snapshot_id: String,
    pub anchor: Option<Anchor>,
    pub body: String,
    pub role: String,
    pub parent_id: Option<String>,
    pub github_draft: bool,
    pub published_url: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS, Default)]
#[serde(rename_all = "camelCase")]
pub struct ReviewProgress {
    pub reviewed: Vec<String>,
    pub acknowledged: Vec<String>,
    pub deferred: Vec<String>,
    pub expanded: Vec<String>,
    pub active_section: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct RemoteComment {
    pub id: String,
    pub author: String,
    pub body: String,
    pub path: Option<String>,
    pub line: Option<u32>,
    pub side: Option<Side>,
    pub commit: Option<String>,
    pub url: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct ReviewWorkspace {
    pub snapshot: Snapshot,
    pub guide: Guide,
    pub notes: Vec<Note>,
    pub progress: ReviewProgress,
    pub comments: Vec<RemoteComment>,
    pub checks: String,
    pub previous_snapshot_id: Option<String>,
    pub changed_hunks: Vec<String>,
    pub sync_error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct RunEvent {
    pub run_id: String,
    pub snapshot_id: String,
    pub phase: String,
    pub text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct PublishRequest {
    pub snapshot_id: String,
    pub note_ids: Vec<String>,
    pub body: String,
    pub event: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct PublishResult {
    pub id: String,
    pub state: String,
    pub url: String,
    pub message: String,
}
