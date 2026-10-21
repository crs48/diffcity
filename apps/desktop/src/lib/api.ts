import { invoke } from "@tauri-apps/api/core";
import type {
  Bootstrap,
  Settings,
  Repository,
  PullRequest,
  PullPage,
  ReviewWorkspace,
  Note,
  Guide,
  ReviewProgress,
  PublishRequest,
  PublishResult,
} from "../../../../packages/contracts/src";
export type * from "../../../../packages/contracts/src";
export const api = {
  bootstrap: () => invoke<Bootstrap>("bootstrap"),
  inbox: () => invoke<PullRequest[]>("refresh_inbox"),
  history: (repository: string | null, page = 1) =>
    invoke<PullPage>("list_pull_history", { repository, page }),
  repositories: () => invoke<Repository[]>("list_repositories"),
  settings: (settings: Settings) =>
    invoke<Settings>("save_settings", { settings }),
  open: (repository: string, number: number, refresh = true) =>
    invoke<ReviewWorkspace>("open_pull", { repository, number, refresh }),
  saved: (snapshotId: string) =>
    invoke<ReviewWorkspace>("open_saved_review", { snapshotId }),
  check: (repository: string, number: number) =>
    invoke<PullRequest>("check_pull", { repository, number }),
  sample: () => invoke<ReviewWorkspace>("sample_review"),
  note: (note: Note) => invoke<Note>("save_note", { note }),
  deleteNote: (id: string) => invoke<void>("delete_note", { id }),
  progress: (snapshotId: string, progress: ReviewProgress) =>
    invoke<ReviewProgress>("save_progress", { snapshotId, progress }),
  analyze: (snapshotId: string, runId: string) =>
    invoke<Guide>("analyze", { snapshotId, runId }),
  ask: (snapshotId: string, noteId: string, runId: string) =>
    invoke<Note>("ask_codex", { snapshotId, noteId, runId }),
  cancel: () => invoke<void>("cancel_codex"),
  publish: (request: PublishRequest) =>
    invoke<PublishResult>("publish_review", { request }),
  external: (url: string) => invoke<void>("open_external", { url }),
};
