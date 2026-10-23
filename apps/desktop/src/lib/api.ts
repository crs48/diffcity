import { invoke } from "@tauri-apps/api/core";
import type {
  Bootstrap,
  LocalCodeDirectory,
  RepositoryContext,
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
  ReviewBaseline,
  ReviewCheckpoint,
  ReviewComparison,
  Note,
  AskReply,
  Guide,
  GuideVersion,
  EnrichmentTier,
  ReviewProgress,
  PublishRequest,
  PublishResult,
} from "../../../../packages/contracts/src";
export type * from "../../../../packages/contracts/src";
export const api = {
  localRepositories: (refresh = false) =>
    invoke<LocalCodeDirectory>("local_repositories", { refresh }),
  saveCodeRoots: (roots: string[]) =>
    invoke<LocalCodeDirectory>("save_code_roots", { roots }),
  bindLocalRepository: (repository: string, path: string | null) =>
    invoke<LocalCodeDirectory>("bind_local_repository", { repository, path }),
  repositoryContext: (repository: string, head?: string) =>
    invoke<RepositoryContext>("repository_context", {
      repository,
      head: head ?? null,
    }),
  chooseCodeFolder: () => invoke<string | null>("choose_code_folder"),
  bootstrap: () => invoke<Bootstrap>("bootstrap"),
  models: (provider = "codex") =>
    invoke<ModelCatalog>("model_catalog", { provider }),
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
  baseline: (snapshotId: string, refresh = false) =>
    invoke<ReviewBaseline>("review_baseline", { snapshotId, refresh }),
  compare: (snapshotId: string, baseline: ReviewCheckpoint) =>
    invoke<ReviewComparison>("compare_review", { snapshotId, baseline }),
  checkpoint: (snapshotId: string) =>
    invoke<ReviewCheckpoint>("save_review_checkpoint", { snapshotId }),
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
  guides: (snapshotId: string) =>
    invoke<GuideVersion[]>("guide_versions", { snapshotId }),
  selectGuide: (snapshotId: string, guideId: string) =>
    invoke<ReviewWorkspace>("select_guide", { snapshotId, guideId }),
  analyze: (snapshotId: string, runId: string, preference?: ModelPreference) =>
    invoke<Guide>("analyze", { snapshotId, runId, preference }),
  enrich: (
    snapshotId: string,
    guideId: string,
    tier: EnrichmentTier,
    runId: string,
  ) => invoke<Guide>("enrich_guide", { snapshotId, guideId, tier, runId }),
  dismissEnrichment: (
    snapshotId: string,
    guideId: string,
    dismissed: boolean,
  ) => invoke<Guide>("dismiss_enrichment", { snapshotId, guideId, dismissed }),
  ask: (
    snapshotId: string,
    noteId: string,
    runId: string,
    preference?: ModelPreference,
  ) => invoke<AskReply>("ask_codex", { snapshotId, noteId, runId, preference }),
  cancel: (runId: string) => invoke<void>("cancel_codex", { runId }),
  publish: (request: PublishRequest) =>
    invoke<PublishResult>("publish_review", { request }),
  external: (url: string) => invoke<void>("open_external", { url }),
};
