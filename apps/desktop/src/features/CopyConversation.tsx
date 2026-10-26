import { useTranslation } from "react-i18next";
import type { Anchor } from "../lib/api";
import { CopyAction } from "../ui/CopyAction";
import type { Conversation } from "./conversation";
import { conversationMarkdown } from "./conversationMarkdown";

export function CopyConversation({
  conversation: c,
  anchor,
  excludeNoteId,
}: {
  conversation: Conversation;
  anchor?: Anchor;
  excludeNoteId?: string;
}) {
  const { t } = useTranslation();
  return (
    <CopyAction
      label={t(
        anchor ? "Copy thread with context" : "Copy PR chat with context",
      )}
      getText={() =>
        conversationMarkdown(c.workspace, {
          anchor,
          replyAnchor: anchor ? undefined : c.chat.draft?.anchor,
          excludeNoteId:
            excludeNoteId ?? (anchor ? undefined : c.chat.draft?.id),
          runs: c.runs,
        })
      }
    />
  );
}
