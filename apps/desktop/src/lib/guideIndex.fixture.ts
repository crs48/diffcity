import fixture from "../../../../tests/fixtures/review-workspace.json";
import type { RemoteComment, ReviewWorkspace } from "./api";
import { newNote } from "./review";

export function indexedWorkspace(): ReviewWorkspace {
  const w = structuredClone(fixture) as ReviewWorkspace;
  const h = w.snapshot.files[0].hunks[0];
  const anchor = {
    hunkId: h.id,
    path: h.path,
    side: "RIGHT" as const,
    startLine: 1,
    line: 1,
  };
  const s = w.guide.sections.find((s) => s.hunkIds.includes(h.id))!;
  s.findings = [
    {
      title: "Existing rows would fail",
      body: "Backfill before NOT NULL.",
      severity: "high",
      anchor,
    },
  ];
  s.annotations = [
    {
      id: "backfill",
      title: "Backfill existing invitations",
      body: "Existing rows need a deadline before the constraint.",
      details: "Validate the existing row count.",
      anchor,
    },
  ];
  s.namingDecisions = [
    {
      kind: "database",
      name: "expires_at",
      previousName: "valid_until",
      reason: "The deadline is a database contract.",
      question: "Does this name mean expiration or redemption?",
      anchor,
    },
  ];
  w.notes = [
    {
      ...newNote(w.snapshot.id, anchor, "What about existing invitations?"),
      id: "question",
      createdAt: "2026-10-23T10:00:00Z",
    },
    {
      ...newNote(w.snapshot.id, anchor, "Backfill before setting NOT NULL."),
      id: "answer",
      role: "assistant",
      parentId: "question",
      threadTitle: "Invitation migration rollout",
      createdAt: "2026-10-23T10:01:00Z",
    },
    {
      ...newNote(w.snapshot.id, null, "How should we roll this out?"),
      id: "pr-question",
    },
  ];
  const root: RemoteComment = {
    id: "root",
    author: "reviewer",
    body: "Please add smoke coverage.",
    path: h.path,
    line: 1,
    side: "RIGHT",
    commit: w.snapshot.pull.head,
    createdAt: "2026-10-23T09:00:00Z",
    url: "https://github.com/example/repo/pull/1#discussion_r1",
  };
  w.comments = [
    {
      ...root,
      id: "reply",
      inReplyToId: root.id,
      path: null,
      line: null,
      side: null,
      body: "This guards against a deployment regression.",
      createdAt: "2026-10-23T09:01:00Z",
    },
    root,
  ];
  return w;
}
