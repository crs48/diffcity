import { useEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { Anchor } from "../lib/api";
import { selectedCode } from "../lib/textSelection";
import { useConversation } from "./conversation";

type Candidate = { anchor: Anchor; x: number; y: number };
export function TextSelectionAction({
  root,
}: {
  root: RefObject<HTMLDivElement | null>;
}) {
  const { t } = useTranslation();
  const conversation = useConversation();
  const current = useRef(conversation);
  current.current = conversation;
  const [candidate, setCandidate] = useState<Candidate | null>(null);
  const action = useRef<Candidate | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    let frame = 0;
    let dragging = false;
    const clear = () => {
      action.current = null;
      setCandidate(null);
    };
    const read = () => {
      frame = 0;
      if (dragging || !current.current?.explainText) return clear();
      const selection = document.getSelection();
      const range =
        selection?.rangeCount === 1 && !selection.isCollapsed
          ? selection.getRangeAt(0)
          : null;
      if (!range || !root.current) {
        // Tab focus on the action must not lose the captured selection.
        if (document.activeElement === button.current) return;
        return clear();
      }
      const anchor = selectedCode(range, root.current);
      if (!anchor) return clear();
      const backwards =
        selection?.focusNode === range.startContainer &&
        selection.focusOffset === range.startOffset;
      const rects = Array.from(range.getClientRects()).filter(
        (r) => r.width && r.height,
      );
      const rect = backwards ? rects[0] : rects.at(-1);
      const viewport = root.current
        .closest<HTMLElement>("[data-review-scroll]")
        ?.getBoundingClientRect();
      if (
        !rect ||
        !viewport ||
        rect.bottom < viewport.top ||
        rect.top > viewport.bottom ||
        rect.right < viewport.left ||
        rect.left > viewport.right
      )
        return clear();
      const next = {
        anchor,
        x: Math.max(
          viewport.left + 8,
          Math.min(rect.right + 8, viewport.right - 145),
        ),
        y: Math.max(
          viewport.top + 4,
          Math.min(rect.top - 36, viewport.bottom - 40),
        ),
      };
      action.current = next;
      setCandidate(next);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(read);
    };
    const down = (e: PointerEvent) => {
      if (button.current?.contains(e.target as Node)) return;
      dragging = true;
      clear();
    };
    const up = () => {
      dragging = false;
      schedule();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape" && action.current) {
        e.preventDefault();
        e.stopPropagation();
        clear();
        document.getSelection()?.removeAllRanges();
      }
      if (
        e.altKey &&
        e.key === "Enter" &&
        action.current &&
        !current.current?.busy
      ) {
        e.preventDefault();
        e.stopPropagation();
        const anchor = action.current.anchor;
        clear();
        void current.current
          ?.explainText?.(anchor)
          .catch(current.current.onError);
        document.getSelection()?.removeAllRanges();
      }
    };
    document.addEventListener("selectionchange", schedule);
    document.addEventListener("pointerdown", down);
    document.addEventListener("pointerup", up);
    document.addEventListener("pointercancel", up);
    document.addEventListener("scroll", schedule, true);
    // Capture before a focused React Aria button handles Enter as a press.
    document.addEventListener("keydown", key, true);
    window.addEventListener("resize", schedule);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("selectionchange", schedule);
      document.removeEventListener("pointerdown", down);
      document.removeEventListener("pointerup", up);
      document.removeEventListener("pointercancel", up);
      document.removeEventListener("scroll", schedule, true);
      document.removeEventListener("keydown", key, true);
      window.removeEventListener("resize", schedule);
    };
  }, [root]);
  if (!candidate || !conversation?.explainText) return null;
  return createPortal(
    <button
      ref={button}
      className="text-selection-action"
      style={{ left: candidate.x, top: candidate.y }}
      aria-label={t("Ask AI to explain selected code")}
      title={t("Explain this selection · AI only · Alt+Enter")}
      disabled={conversation.busy}
      onPointerDown={(e) => e.preventDefault()}
      onClick={() => {
        const anchor = action.current?.anchor;
        action.current = null;
        setCandidate(null);
        if (anchor)
          void conversation.explainText!(anchor).catch(conversation.onError);
        document.getSelection()?.removeAllRanges();
      }}
    >
      <Sparkles size={14} />
      {t("Ask AI")}
      <span className="sr-only">
        {t("Private text selection; never published to GitHub")}
      </span>
    </button>,
    document.body,
  );
}
