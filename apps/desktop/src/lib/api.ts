import { invoke } from "@tauri-apps/api/core";
import type {
  Bootstrap,
  ModelCatalog,
  ModelPreference,
  HunkContext,
  Pins,
  Settings,
  RepositoryDirectory,
  InboxResult,
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
  models: () => invoke<ModelCatalog>("model_catalog"),
  modelPreference: (preference: ModelPreference) =>
    invoke<ModelPreference>("save_model_preference", { preference }),
  inbox: () => invoke<InboxResult>("refresh_inbox"),
  history: (repository: string | null, page = 1, owner: string | null = null) =>
    invoke<PullPage>("list_pull_history", { repository, page, owner }),
  pinRepository: (repository: string, pinned: boolean) =>
    invoke<Pins>("pin_repository", { repository, pinned }),
  pinPull: (pull: PullRequest, pinned: boolean) =>
    invoke<Pins>("pin_pull", { pull, pinned }),
  directory: () => invoke<RepositoryDirectory>("refresh_directory"),
  settings: (settings: Settings) =>
    invoke<Settings>("save_settings", { settings }),
  open: (repository: string, number: number, refresh = false) =>
    invoke<ReviewWorkspace>("open_pull", { repository, number, refresh }),
  sync: (repository: string, number: number) =>
    invoke<ReviewWorkspace>("sync_pull", { repository, number }),
  prefetch: (pull: PullRequest) => invoke<boolean>("prefetch_pull", { pull }),
  saved: (snapshotId: string) =>
    invoke<ReviewWorkspace>("open_saved_review", { snapshotId }),
  context: (
    snapshotId: string,
    hunkId: string,
    before: number,
    after: number,
  ) =>
    invoke<HunkContext>("hunk_context", { snapshotId, hunkId, before, after }),
  check: (repository: string, number: number) =>
    invoke<PullRequest>("check_pull", { repository, number }),
  sampleInbox: () => invoke<PullRequest[]>("sample_inbox"),
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
