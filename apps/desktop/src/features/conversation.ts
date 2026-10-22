import { createContext, useContext } from "react";
import type { Anchor, Note, ReviewWorkspace } from "../lib/api";
import type { NoteComposerState } from "./useNoteComposer";

export type Conversation = {
  workspace: ReviewWorkspace;
  inline: NoteComposerState;
  chat: NoteComposerState;
  busy: boolean;
  activeQuestion: Note | null;
  stream: string;
  ask: (note: Note) => Promise<void>;
  explainText?: (anchor: Anchor) => Promise<void>;
  prepare: (note: Note) => Promise<void>;
  edit: (note: Note, inline: boolean) => Promise<void>;
  openInline: (anchor: Anchor) => void;
  openChat: (anchor: Anchor | null) => void;
  onError: (error: unknown) => void;
};
export const ConversationContext = createContext<Conversation | null>(null);
export const useConversation = () => useContext(ConversationContext);
