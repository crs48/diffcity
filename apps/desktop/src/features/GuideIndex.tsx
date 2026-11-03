import { useEffect, useId, useMemo, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import {
  Button,
  Dialog,
  DialogTrigger,
  Popover,
  PreviewTrigger,
  Tooltip,
  TooltipTrigger,
} from "react-aria-components";
import {
  BookOpen,
  Check,
  CircleDot,
  Flag,
  Github,
  Highlighter,
  Info,
  Layers,
  ListTree,
  Search,
  Sparkles,
  Tag,
  X,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ReviewWorkspace } from "../lib/api";
import {
  buildGuideIndex,
  indexExcerpt,
  type GuideIndexEntry,
  type GuideIndexKind,
  type IndexGroup,
} from "../lib/guideIndex";
import { IconAction } from "../ui/IconAction";
import { useGuideIndexLayout } from "./useGuideIndexLayout";
import { useGuideIndexScrub } from "./useGuideIndexScrub";
import { useConversation } from "./conversation";
import { replyScope } from "../lib/readReplies";
import {
  combinedActivity,
  emptyActivity,
  replyActivity,
  useReadReplies,
  type ReplyActivity as Activity,
} from "./useReplyActivity";
import { ReplyActivity, replyActivityLabel } from "./ReplyActivity";

type Activities = ReadonlyMap<string, Activity>;
const entryActivity = (entry: GuideIndexEntry, activities: Activities) =>
  entry.kind === "conversation"
    ? (activities.get(entry.id.slice("conversation:".length)) ?? emptyActivity)
    : emptyActivity;

const kinds = {
  overview: { label: "Overview", Icon: BookOpen },
  section: { label: "Section", Icon: CircleDot },
  conversation: { label: "AI conversation", Icon: Sparkles },
  comment: { label: "Review comment", Icon: Github },
  naming: { label: "Name to confirm", Icon: Tag },
  note: { label: "Code note", Icon: Highlighter },
  finding: { label: "Finding", Icon: Flag },
} satisfies Record<GuideIndexKind, { label: string; Icon: typeof BookOpen }>;
const categories: GuideIndexKind[] = [
  "section",
  "conversation",
  "comment",
  "naming",
  "note",
  "finding",
];

function EntryIcon({ entry }: { entry: GuideIndexEntry }) {
  const Icon = kinds[entry.kind].Icon;
  return entry.kind === "section" ? (
    <span className="guide-index-number">{entry.sectionNumber}</span>
  ) : (
    <Icon size={15} aria-hidden />
  );
}

function EntryPreview({
  entry,
  activity,
  statusId,
  compact = false,
}: {
  entry: GuideIndexEntry;
  activity: Activity;
  statusId: string;
  compact?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className={`guide-index-preview index-${entry.kind}`}>
      <span className="guide-index-type">
        <EntryIcon entry={entry} />
        {t(kinds[entry.kind].label)}
        {entry.chat ? ` · ${t("PR chat")}` : ""}
      </span>
      <strong>{entry.title || t(kinds[entry.kind].label)}</strong>
      <span
        id={statusId}
        hidden={!activity.unread && !activity.working && !activity.queued}
      >
        <ReplyActivity activity={activity} />
      </span>
      {entry.reviewed && (
        <span className="guide-index-reviewed-label">
          <Check size={13} aria-hidden />
          {t("Code reviewed")}
        </span>
      )}
      {!compact && entry.body && <p>{indexExcerpt(entry.body)}</p>}
      {entry.anchor && (
        <small>
          {entry.anchor.path} ·{" "}
          {t(entry.anchor.side === "LEFT" ? "Old" : "New")}{" "}
          {entry.anchor.startLine}
          {entry.anchor.startLine !== entry.anchor.line
            ? `–${entry.anchor.line}`
            : ""}
        </small>
      )}
    </div>
  );
}

function IndexList({
  entries,
  activities,
  onJump,
  close,
  title,
}: {
  entries: GuideIndexEntry[];
  activities: Activities;
  onJump: (entry: GuideIndexEntry) => void;
  close: () => void;
  title: string;
}) {
  const { t } = useTranslation();
  const statusPrefix = useId();
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<GuideIndexKind | "unread" | null>(null);
  const filtered = entries.filter(
    (e) =>
      (!kind ||
        (kind === "unread" && entryActivity(e, activities).unread > 0) ||
        e.kind === kind ||
        (kind === "section" && e.kind === "overview")) &&
      `${e.title} ${e.body} ${e.anchor?.path ?? ""}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const choose = (entry: GuideIndexEntry) => {
    close();
    // Let React Aria restore the trigger before focusing the document target.
    requestAnimationFrame(() => onJump(entry));
  };
  return (
    <>
      <header>
        <h2>{title}</h2>
        <Button
          className="icon-button"
          aria-label={t("Close guide index")}
          onPress={close}
        >
          <X size={16} />
        </Button>
      </header>
      <label className="guide-index-search">
        <Search size={14} aria-hidden />
        <input
          aria-label={t("Search guide index")}
          placeholder={t("Find a section, name, or conversation…")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>
      <div
        className="guide-index-filters"
        role="group"
        aria-label={t("Index categories")}
      >
        <Button aria-pressed={!kind} onPress={() => setKind(null)}>
          {t("All locations")}
        </Button>
        <Button
          aria-pressed={kind === "unread"}
          onPress={() => setKind(kind === "unread" ? null : "unread")}
        >
          <span className="reply-unread-dot" aria-hidden />
          {t("Unread AI")}
        </Button>
        {categories
          .filter((k) => entries.some((e) => e.kind === k))
          .map((k) => {
            const Icon = kinds[k].Icon;
            return (
              <Button
                key={k}
                className={`index-${k}`}
                aria-pressed={kind === k}
                onPress={() => setKind(kind === k ? null : k)}
              >
                <Icon size={13} aria-hidden />
                {t(kinds[k].label)}
              </Button>
            );
          })}
      </div>
      <div
        className="guide-index-results"
        role="list"
        aria-label={t("Guide locations")}
      >
        {filtered.map((entry, index) => (
          <div role="listitem" key={entry.id}>
            <Button
              onPress={() => choose(entry)}
              aria-describedby={`${statusPrefix}-${index}`}
              aria-label={t("Jump to {{title}}", {
                title: entry.title || t(kinds[entry.kind].label),
              })}
            >
              <EntryPreview
                entry={entry}
                activity={entryActivity(entry, activities)}
                statusId={`${statusPrefix}-${index}`}
              />
            </Button>
          </div>
        ))}
        {!filtered.length && (
          <p className="muted">{t("No matching locations.")}</p>
        )}
      </div>
    </>
  );
}

function IndexMarker({
  group,
  activities,
  active,
  tabIndex,
  onFocus,
  onJump,
  onGroupJump,
  scrubbing,
  didDrag,
}: {
  group: IndexGroup;
  activities: Activities;
  active: boolean;
  tabIndex: number;
  onFocus: () => void;
  onJump: (entry: GuideIndexEntry) => void;
  onGroupJump: (group: IndexGroup) => void;
  scrubbing: boolean;
  didDrag: RefObject<boolean>;
}) {
  const { t } = useTranslation();
  const statusPrefix = useId();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (scrubbing) setOpen(false);
  }, [scrubbing]);
  const { items } = group;
  const activity = combinedActivity(
    items.map((entry) => entryActivity(entry, activities)),
  );
  const busy = activity.working + activity.queued > 0;
  const mixed = new Set(items.map((e) => e.kind)).size > 1;
  const first = items[0];
  const label =
    items.length > 1
      ? t("{{count}} guide locations near {{title}}", {
          count: items.length,
          title: first.title,
        })
      : first.kind === "section"
        ? t("Section {{number}}: {{title}}", {
            number: first.sectionNumber,
            title: first.title,
          })
        : `${t(kinds[first.kind].label)}: ${first.title}`;
  return (
    <div className="guide-index-marker-position" style={{ top: group.top }}>
      <PreviewTrigger
        delay={220}
        closeDelay={250}
        isDisabled={scrubbing}
        isOpen={open && !scrubbing}
        onOpenChange={setOpen}
      >
        <Button
          className={`guide-index-marker ${group.lane} index-${mixed ? "mixed" : first.kind}`}
          aria-label={[
            label,
            items.length === 1 && first.reviewed ? t("Code reviewed") : "",
            replyActivityLabel(activity, t),
          ]
            .filter(Boolean)
            .join(" · ")}
          aria-current={active ? "location" : undefined}
          data-index-marker={group.id}
          excludeFromTabOrder={tabIndex < 0}
          onFocus={onFocus}
          onPress={(event) => {
            if (
              didDrag.current &&
              event.pointerType !== "keyboard" &&
              event.pointerType !== "virtual"
            )
              return;
            setOpen(false);
            if (items.length > 1) onGroupJump(group);
            else onJump(first);
          }}
        >
          {busy ? null : group.lane === "sections" ? (
            <span className="guide-index-chapter-dot" aria-hidden />
          ) : mixed ? (
            <Layers size={15} aria-hidden />
          ) : (
            <EntryIcon entry={first} />
          )}
          <ReplyActivity activity={activity} compact />
          {items.length > 1 && group.lane === "activity" && (
            <span className="guide-index-count">
              {items.length > 99 ? "99+" : items.length}
            </span>
          )}
        </Button>
        {open && !scrubbing && (
          <Popover
            placement="right"
            offset={8}
            containerPadding={12}
            className="guide-index-preview-popover"
            aria-label={t("Guide locations")}
          >
            <div
              className="guide-index-results"
              role="list"
              aria-label={t("Guide locations")}
            >
              {items.map((entry, index) => (
                <div key={entry.id} role="listitem">
                  <Button
                    aria-describedby={`${statusPrefix}-${index}`}
                    aria-label={t("Jump to {{title}}", {
                      title: entry.title || t(kinds[entry.kind].label),
                    })}
                    onPress={() => {
                      setOpen(false);
                      // Close the preview before moving focus into the guide.
                      requestAnimationFrame(() => onJump(entry));
                    }}
                  >
                    <EntryPreview
                      entry={entry}
                      activity={entryActivity(entry, activities)}
                      statusId={`${statusPrefix}-${index}`}
                      compact={items.length > 1}
                    />
                  </Button>
                </div>
              ))}
            </div>
          </Popover>
        )}
      </PreviewTrigger>
    </div>
  );
}

export function GuideIndex({
  workspace: w,
  root,
  activeSection,
  onJump,
}: {
  workspace: ReviewWorkspace;
  root: RefObject<HTMLDivElement | null>;
  activeSection: string;
  onJump: (entry: GuideIndexEntry) => void;
}) {
  const { t } = useTranslation();
  const { snapshot, guide, notes, comments, progress } = w;
  const conversation = useConversation();
  const read = useReadReplies(replyScope(snapshot.pull));
  // Keep activity out of the geometry inputs: streamed tokens and read receipts
  // should only repaint status, never rescan the guide's layout.
  const activities = replyActivity(
    notes,
    conversation?.runs ?? [],
    snapshot.id,
    read,
  );
  const entries = useMemo(
    () => buildGuideIndex({ snapshot, guide, notes, comments, progress }),
    [snapshot, guide, notes, comments, progress],
  );
  const { host, groups, sectionRanges, track, indicator, scrubber } =
    useGuideIndexLayout(root, entries);
  const scrub = useGuideIndexScrub(root, track, scrubber);
  const reviewed = new Set(
    entries.filter((entry) => entry.reviewed).map((entry) => entry.sectionId),
  );
  const [focused, setFocused] = useState("");
  const tabStop = groups.some((g) => g.id === focused)
    ? focused
    : groups[0]?.id;
  const jumpToGroup = (group: IndexGroup) => {
    const element = root.current;
    const viewport = element?.closest<HTMLElement>("[data-review-scroll]");
    if (!element || !viewport) return;
    viewport.dispatchEvent(new Event("review-scroll-intent"));
    const bounds = element.getBoundingClientRect();
    viewport.scrollTo({
      top: Math.max(
        0,
        viewport.scrollTop +
          bounds.top -
          viewport.getBoundingClientRect().top +
          group.position * bounds.height -
          16,
      ),
      behavior: "auto",
    });
  };
  if (!host) return null;
  return createPortal(
    <nav className="guide-index" aria-label={t("Guide index")}>
      <DialogTrigger>
        <IconAction
          className="icon-button guide-index-browse"
          label={t("Browse guide index ({{count}} locations)", {
            count: entries.length,
          })}
        >
          <ListTree size={18} aria-hidden />
        </IconAction>
        <Popover
          className="guide-index-popover"
          placement="right top"
          offset={10}
        >
          <Dialog aria-label={t("Guide index")}>
            {({ close }) => (
              <IndexList
                entries={entries}
                activities={activities}
                title={t("Guide index")}
                close={close}
                onJump={onJump}
              />
            )}
          </Dialog>
        </Popover>
      </DialogTrigger>
      <div
        ref={track}
        className="guide-index-track"
        data-scrubbing={scrub.scrubbing || undefined}
        {...scrub.pointerHandlers}
        onKeyDown={(event) => {
          if (
            !(event.target instanceof HTMLElement) ||
            !event.target.closest("[data-index-marker]") ||
            !["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)
          )
            return;
          const buttons = [
            ...event.currentTarget.querySelectorAll<HTMLButtonElement>(
              "[data-index-marker]",
            ),
          ];
          const index = buttons.indexOf(event.target.closest("button")!);
          const next =
            event.key === "Home"
              ? 0
              : event.key === "End"
                ? buttons.length - 1
                : Math.max(
                    0,
                    Math.min(
                      buttons.length - 1,
                      index + (event.key === "ArrowDown" ? 1 : -1),
                    ),
                  );
          event.preventDefault();
          buttons[next]?.focus();
        }}
      >
        <div
          ref={scrubber}
          className="guide-index-scrubber"
          role="slider"
          tabIndex={0}
          aria-label={t("Guide position")}
          aria-orientation="vertical"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={0}
          onKeyDown={scrub.onKeyDown}
        />
        {sectionRanges
          .filter((range) => reviewed.has(range.id))
          .map((range) => (
            <div
              key={range.id}
              className="guide-index-reviewed-section"
              data-reviewed-section={range.id}
              style={{ top: range.top, height: Math.max(1, range.height - 2) }}
              aria-hidden
            />
          ))}
        <div className="guide-index-viewport" ref={indicator} aria-hidden />
        {groups.map((group) => (
          <IndexMarker
            key={group.id}
            group={group}
            activities={activities}
            active={group.items.some(
              (e) =>
                (e.kind === "section" || e.kind === "overview") &&
                e.sectionId === activeSection,
            )}
            tabIndex={group.id === tabStop ? 0 : -1}
            onFocus={() => setFocused(group.id)}
            onJump={onJump}
            onGroupJump={jumpToGroup}
            scrubbing={scrub.scrubbing}
            didDrag={scrub.didDrag}
          />
        ))}
      </div>
      <TooltipTrigger delay={220}>
        <Button
          className="icon-button guide-index-key"
          aria-label={t("Guide index key")}
        >
          <Info size={15} aria-hidden />
        </Button>
        <Tooltip placement="right bottom" className="guide-index-tooltip">
          <strong>{t("Guide index key")}</strong>
          <p className="guide-index-legend">
            <span className="guide-index-reviewed-swatch" aria-hidden />
            {t("Reviewed section")}
          </p>
          <p className="guide-index-legend">
            <ReplyActivity activity={{ ...emptyActivity, working: 1 }} />
          </p>
          <p className="guide-index-legend">
            <ReplyActivity activity={{ ...emptyActivity, unread: 1 }} />
          </p>
          {categories.map((kind) => {
            const Icon = kinds[kind].Icon;
            return (
              <p className={`guide-index-legend index-${kind}`} key={kind}>
                <Icon size={14} aria-hidden />
                {t(kinds[kind].label)}
              </p>
            );
          })}
          <p className="muted">
            {t(
              "Hover to browse locations. Click a preview to jump there. Click or drag the rail to scroll. Use arrow keys to move between markers.",
            )}
          </p>
        </Tooltip>
      </TooltipTrigger>
    </nav>,
    host,
  );
}
