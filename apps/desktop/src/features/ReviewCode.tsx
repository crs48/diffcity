import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { Button, Checkbox } from "react-aria-components";
import { ArrowDown, ArrowUp, Search } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { Anchor, ChangedFile } from "../lib/api";
import { findCode, type CodeMatch } from "../lib/codeSearch";
import { followScrollTarget } from "../lib/scrollTarget";
import { createFileNavigation, FileNavigationContext } from "./fileNavigation";
import { FileMinimap } from "./FileMinimap";
import { TextSelectionAction } from "./TextSelectionAction";
import {
  ReviewRenderingContext,
  VIRTUAL_REVIEW_THRESHOLD,
} from "./reviewRendering";

const preference = "diffcity.render-all-code";
const readPreference = () => {
  try {
    return localStorage.getItem(preference) === "true";
  } catch {
    return false;
  }
};

export function ReviewCode({
  files,
  onSelect,
  onReveal,
  children,
}: {
  files: ChangedFile[];
  onSelect: (anchor: Anchor) => void;
  onReveal: () => void;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const root = useRef<HTMLDivElement>(null);
  const [navigation] = useState(createFileNavigation);
  const input = useRef<HTMLInputElement>(null);
  const [all, setAll] = useState(readPreference);
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(-1);
  const pending = useRef<CodeMatch | null>(null);
  const stopJump = useRef<() => void>(() => {});
  const count = useMemo(
    () =>
      files.reduce(
        (total, file) =>
          total + file.hunks.reduce((n, hunk) => n + hunk.lines.length, 0),
        0,
      ),
    [files],
  );
  const large = count >= VIRTUAL_REVIEW_THRESHOLD;
  const matches = useMemo(() => findCode(files, query), [files, query]);
  const renderAll = (value: boolean) => {
    setAll(value);
    try {
      localStorage.setItem(preference, String(value));
    } catch {
      /* Session preference still works. */
    }
  };
  const reveal = (direction: number) => {
    if (!matches.length) return;
    const next =
      index < 0
        ? direction < 0
          ? matches.length - 1
          : 0
        : (index + direction + matches.length) % matches.length;
    setIndex(next);
    pending.current = matches[next];
    onReveal();
    onSelect(matches[next].anchor);
  };
  // Selection expands the destination chapter/hunk and pins its code block first.
  useEffect(() => {
    if (!pending.current) return;
    const frame = requestAnimationFrame(() => {
      const match = pending.current;
      if (!match) return;
      const file = [
        ...(root.current?.querySelectorAll<HTMLElement>(
          ".diff-file[data-hunk-id]",
        ) ?? []),
      ].find((element) => element.dataset.hunkId === match.anchor.hunkId);
      const row = file?.querySelector<HTMLElement>(
        `[data-code-index="${match.codeIndex}"]`,
      );
      if (row) {
        const viewport = row.closest<HTMLElement>("[data-review-scroll]");
        if (viewport) {
          stopJump.current();
          stopJump.current = followScrollTarget(
            viewport,
            row,
            () => (viewport.clientHeight - row.offsetHeight) / 2,
          );
        }
        pending.current = null;
      }
    });
    return () => cancelAnimationFrame(frame);
  });
  useEffect(() => () => stopJump.current(), []);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
      if (event.key.toLowerCase() === "f") {
        event.preventDefault();
        input.current?.focus();
        input.current?.select();
      }
      const target = event.target instanceof Element ? event.target : null;
      const selection = document.getSelection()?.anchorNode?.parentElement;
      if (
        event.key.toLowerCase() === "a" &&
        !target?.closest("input, textarea, [contenteditable=true]") &&
        (target?.closest(".diff-chunks") || selection?.closest(".diff-chunks"))
      ) {
        // Native Select All must see the complete document before its default action.
        flushSync(() => setAll(true));
      }
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, []);
  return (
    <ReviewRenderingContext.Provider value={large && !all}>
      <FileNavigationContext.Provider value={navigation}>
        <div className="review-code" ref={root}>
          <TextSelectionAction root={root} />
          <div
            className="review-code-tools"
            role="search"
            aria-label={t("Find in code")}
          >
            <Search size={14} aria-hidden />
            <input
              ref={input}
              type="search"
              value={query}
              aria-label={t("Find in code")}
              placeholder={t("Find in code…")}
              onChange={(event) => {
                stopJump.current();
                setQuery(event.target.value);
                setIndex(-1);
                pending.current = null;
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  reveal(event.shiftKey ? -1 : 1);
                }
              }}
            />
            <span className="code-search-count" role="status">
              {query.trim() &&
                t("{{current}} of {{total}} matching lines", {
                  current: index + 1,
                  total: matches.length,
                })}
            </span>
            <Button
              className="icon-button"
              aria-label={t("Previous code match")}
              isDisabled={!matches.length}
              onPress={() => reveal(-1)}
            >
              <ArrowUp size={14} />
            </Button>
            <Button
              className="icon-button"
              aria-label={t("Next code match")}
              isDisabled={!matches.length}
              onPress={() => reveal(1)}
            >
              <ArrowDown size={14} />
            </Button>
            {large && (
              <Checkbox
                className="render-all-code"
                isSelected={all}
                onChange={renderAll}
                aria-describedby="render-all-code-help"
              >
                <span className="checkbox-indicator" aria-hidden />
                {t("Render all code")}
              </Checkbox>
            )}
            {large && (
              <span id="render-all-code-help" className="sr-only">
                {t(
                  "Enable for full-document screen-reader navigation and text selection. Large reviews otherwise load code as you scroll. Find in code searches every captured diff line.",
                )}
              </span>
            )}
          </div>
          {index >= 0 && matches[index] && (
            <div className="code-search-location" aria-live="polite">
              {matches[index].anchor.path} ·{" "}
              {matches[index].anchor.side === "LEFT" ? t("Old") : t("New")}{" "}
              {t("line")} {matches[index].anchor.line}
            </div>
          )}
          {children}
          <FileMinimap />
        </div>
      </FileNavigationContext.Provider>
    </ReviewRenderingContext.Provider>
  );
}
