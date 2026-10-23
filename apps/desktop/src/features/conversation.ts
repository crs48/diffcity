import { createContext, useContext } from "react";
import type {
  AgentAccess,
  AgentAnswer,
  Anchor,
  Note,
  ModelPreference,
  ReviewWorkspace,
} from "../lib/api";
import type { AiRun } from "./useAiRuns";
import type { NoteComposerState } from "./useNoteComposer";

export type Conversation = {
  workspace: ReviewWorkspace;
  access?: AgentAccess;
  setAccess?: (access: AgentAccess) => void;
  respondAgent?: (
    runId: string,
    requestId: string,
    answer: AgentAnswer,
  ) => Promise<void>;
  inline: NoteComposerState;
  chat: NoteComposerState;
  runs: AiRun[];
  modelFor: (anchor: Anchor | null) => ModelPreference;
  isBusy: (anchor: Anchor | null) => boolean;
  cancel: (id: string) => Promise<void>;
  dismiss: (id: string) => void;
  ask: (note: Note) => Promise<void>;
  explainText?: (anchor: Anchor, question?: string) => Promise<void>;
  prepare: (note: Note) => Promise<void>;
  edit: (note: Note, inline: boolean) => Promise<void>;
  openInline: (anchor: Anchor) => void;
  openChat: (anchor: Anchor | null) => void;
  onError: (error: unknown) => void;
};
export const ConversationContext = createContext<Conversation | null>(null);
export const useConversation = () => useContext(ConversationContext);
