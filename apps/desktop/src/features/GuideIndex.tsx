import { useMemo, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import {
  Button,
  Dialog,
  DialogTrigger,
  Popover,
  Tooltip,
  TooltipTrigger,
} from "react-aria-components";
import {
  BookOpen,
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

const kinds = {
  overview: { label: "Overview", Icon: BookOpen },
  section: { label: "Section", Icon: BookOpen },
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
  compact = false,
}: {
  entry: GuideIndexEntry;
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
  onJump,
  close,
  title,
}: {
  entries: GuideIndexEntry[];
  onJump: (entry: GuideIndexEntry) => void;
  close: () => void;
  title: string;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<GuideIndexKind | null>(null);
  const filtered = entries.filter(
    (e) =>
      (!kind ||
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
        {filtered.map((entry) => (
          <div role="listitem" key={entry.id}>
            <Button
              onPress={() => choose(entry)}
              aria-label={t("Jump to {{title}}", {
                title: entry.title || t(kinds[entry.kind].label),
              })}
            >
              <EntryPreview entry={entry} />
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
  active,
  tabIndex,
  onFocus,
  onJump,
}: {
  group: IndexGroup;
  active: boolean;
  tabIndex: number;
  onFocus: () => void;
  onJump: (entry: GuideIndexEntry) => void;
}) {
  const { t } = useTranslation();
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const { items } = group;
  const mixed = new Set(items.map((e) => e.kind)).size > 1;
  const first = items[0];
  const label =
    items.length > 1
      ? t("{{count}} guide locations near {{title}}", {
          count: items.length,
          title: first.title,
        })
      : `${t(kinds[first.kind].label)}: ${first.title}`;
  return (
    <>
      <TooltipTrigger delay={220} isDisabled={open}>
        <Button
          ref={trigger}
          className={`guide-index-marker ${group.lane} index-${mixed ? "mixed" : first.kind}`}
          style={{ top: group.top }}
          aria-label={label}
          aria-current={active ? "location" : undefined}
          aria-haspopup={items.length > 1 ? "dialog" : undefined}
          aria-expanded={items.length > 1 ? open : undefined}
          data-index-marker={group.id}
          excludeFromTabOrder={tabIndex < 0}
          onFocus={onFocus}
          onPress={() => (items.length > 1 ? setOpen(true) : onJump(first))}
        >
          {mixed ? (
            <Layers size={15} aria-hidden />
          ) : (
            <EntryIcon entry={first} />
          )}
          {items.length > 1 && (
            <span className="guide-index-count">
              {items.length > 99 ? "99+" : items.length}
            </span>
          )}
        </Button>
        <Tooltip placement="right" offset={10} className="guide-index-tooltip">
          {items.slice(0, 3).map((entry) => (
            <EntryPreview
              key={entry.id}
              entry={entry}
              compact={items.length > 1}
            />
          ))}
          {items.length > 1 && (
            <p className="muted">
              {t("Click to explore all {{count}} locations", {
                count: items.length,
              })}
            </p>
          )}
        </Tooltip>
      </TooltipTrigger>
      <Popover
        triggerRef={trigger}
        isOpen={open}
        onOpenChange={setOpen}
        className="guide-index-popover"
        placement="right top"
        offset={10}
      >
        <Dialog aria-label={t("Nearby guide locations")}>
          <IndexList
            entries={items}
            title={t("Nearby guide locations")}
            close={() => setOpen(false)}
            onJump={onJump}
          />
        </Dialog>
      </Popover>
    </>
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
  const { snapshot, guide, notes, comments } = w;
  const entries = useMemo(
    () => buildGuideIndex({ snapshot, guide, notes, comments }),
    [snapshot, guide, notes, comments],
  );
  const { host, groups, track, indicator } = useGuideIndexLayout(root, entries);
  const [focused, setFocused] = useState("");
  const tabStop = groups.some((g) => g.id === focused)
    ? focused
    : groups[0]?.id;
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
        <div className="guide-index-viewport" ref={indicator} aria-hidden />
        {groups.map((group) => (
          <IndexMarker
            key={group.id}
            group={group}
            active={group.items.some(
              (e) =>
                (e.kind === "section" || e.kind === "overview") &&
                e.sectionId === activeSection,
            )}
            tabIndex={group.id === tabStop ? 0 : -1}
            onFocus={() => setFocused(group.id)}
            onJump={onJump}
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
              "Hover to preview. Click to jump. Use arrow keys to move between markers.",
            )}
          </p>
        </Tooltip>
      </TooltipTrigger>
    </nav>,
    host,
  );
}
