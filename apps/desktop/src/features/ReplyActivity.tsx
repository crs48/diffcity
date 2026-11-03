import { LoaderCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import type { ReplyActivity as Activity } from "./useReplyActivity";

export const replyActivityLabel = (activity: Activity, t: TFunction) =>
  [
    activity.working
      ? t("AI is thinking")
      : activity.queued
        ? t("AI response queued")
        : "",
    activity.unread
      ? `${t("Unread AI response")}${activity.unread > 1 ? ` (${activity.unread})` : ""}`
      : "",
  ]
    .filter(Boolean)
    .join(" · ");

export function ReplyActivity({
  activity,
  compact = false,
}: {
  activity: Activity;
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const busy = activity.working + activity.queued > 0;
  if (!busy && !activity.unread) return null;
  return (
    <span
      className={`reply-activity${compact ? " compact" : ""}`}
      role={compact ? "img" : undefined}
      aria-label={compact ? replyActivityLabel(activity, t) : undefined}
    >
      {busy && (
        <span
          className="reply-thinking"
          title={t(activity.working ? "AI is thinking" : "AI response queued")}
        >
          <LoaderCircle size={compact ? 15 : 13} className="spin" aria-hidden />
          {!compact && (
            <span>
              {t(activity.working ? "AI is thinking" : "AI response queued")}
            </span>
          )}
        </span>
      )}
      {!!activity.unread && (
        <span className="reply-unread" title={t("Unread AI response")}>
          <span className="reply-unread-dot" aria-hidden />
          {!compact && (
            <span>
              {t("Unread AI response")}
              {activity.unread > 1 ? ` (${activity.unread})` : ""}
            </span>
          )}
        </span>
      )}
    </span>
  );
}
