import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { ArrowUp, Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { Anchor } from "../lib/api";
import { selectedCode } from "../lib/textSelection";
import { sameAnchor } from "../lib/selection";
import { useConversation } from "./conversation";

type Source = { anchor: Anchor; range: Range; backwards: boolean };
type Candidate = Source & { x: number; y: number; width: number };

/** Keep the composer beside the selection and inside the visible review pane. */
function position(
  source: Source,
  root: HTMLElement | null,
  height: number,
): Candidate | null {
  if (!root || !root.contains(source.range.commonAncestorContainer))
    return null;
  const rects = Array.from(source.range.getClientRects()).filter(
    (r) => r.width && r.height,
  );
  const rect = source.backwards ? rects[0] : rects.at(-1);
  const viewport = root
    .closest<HTMLElement>("[data-review-scroll]")
    ?.getBoundingClientRect();
  if (!rect || !viewport) return null;
  const left = Math.max(0, viewport.left) + 8;
  const right = Math.min(window.innerWidth, viewport.right) - 8;
  const top = Math.max(0, viewport.top) + 8;
  const bottom = Math.min(window.innerHeight, viewport.bottom) - 8;
  if (
    rect.bottom < top ||
    rect.top > bottom ||
    rect.right < left ||
    rect.left > right ||
    right <= left ||
    bottom - top < height
  )
    return null;
  const width = Math.min(380, right - left);
  const above = rect.top - height - 8;
  return {
    ...source,
    width,
    x: Math.max(left, Math.min(rect.left, right - width)),
    y: Math.max(
      top,
      Math.min(above >= top ? above : rect.bottom + 8, bottom - height),
    ),
  };
}

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
  const popover = useRef<HTMLFormElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const hintId = useId();
  const clear = useCallback(() => {
    action.current = null;
    setCandidate(null);
  }, []);
  const send = useCallback(() => {
    const selected = action.current;
    const conversation = current.current;
    if (
      !selected ||
      !conversation?.explainText ||
      conversation.isBusy(selected.anchor)
    )
      return;
    const question = input.current?.value.trim() || undefined;
    clear();
    document.getSelection()?.removeAllRanges();
    void conversation
      .explainText(selected.anchor, question)
      .catch(conversation.onError);
  }, [clear]);

  useEffect(() => {
    clear();
    let frame = 0;
    let dragging = false;
    let keyboardSelecting = false;
    const place = (source: Source) => {
      const next = position(
        source,
        root.current,
        popover.current?.offsetHeight || 76,
      );
      action.current = next;
      setCandidate(next);
    };
    const read = () => {
      frame = 0;
      // Focusing/typing in the question field changes the browser selection.
      // Its captured code range stays independent of that editable selection.
      if (
        dragging ||
        keyboardSelecting ||
        popover.current?.contains(document.activeElement)
      )
        return;
      if (!current.current?.explainText) return clear();
      const selection = document.getSelection();
      if (
        !selection ||
        selection.rangeCount !== 1 ||
        selection.isCollapsed ||
        !root.current
      )
        return clear();
      const range = selection.getRangeAt(0);
      const anchor = selectedCode(range, root.current);
      if (!anchor) return clear();
      if (!sameAnchor(action.current?.anchor ?? null, anchor)) {
        previousFocus.current =
          document.activeElement instanceof HTMLElement
            ? document.activeElement
            : null;
        if (input.current) input.current.value = "";
      }
      place({
        anchor,
        range: range.cloneRange(),
        backwards:
          selection.focusNode === range.startContainer &&
          selection.focusOffset === range.startOffset,
      });
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(read);
    };
    const down = (e: PointerEvent) => {
      if (popover.current?.contains(e.target as Node)) return;
      const target = e.target instanceof Element ? e.target : null;
      dragging =
        e.button === 0 &&
        !!root.current?.contains(target) &&
        !!target?.closest("code[data-code-text]");
      if (action.current && !dragging)
        document.getSelection()?.removeAllRanges();
      clear();
    };
    const up = () => {
      if (!dragging) return;
      dragging = false;
      schedule();
    };
    const cancel = () => {
      dragging = false;
      clear();
    };
    const reposition = () => {
      if (action.current) place(action.current);
    };
    const key = (e: KeyboardEvent) => {
      if (e.isComposing || e.keyCode === 229) return;
      if (e.key === "Shift" && !popover.current?.contains(e.target as Node))
        keyboardSelecting = true;
      if (e.key === "Escape" && action.current) {
        e.preventDefault();
        e.stopPropagation();
        const focused = popover.current?.contains(document.activeElement);
        clear();
        document.getSelection()?.removeAllRanges();
        if (focused && previousFocus.current?.isConnected)
          previousFocus.current.focus({ preventScroll: true });
      }
      if (e.altKey && e.key === "Enter" && action.current) {
        e.preventDefault();
        e.stopPropagation();
        send();
      }
    };
    const keyUp = (e: KeyboardEvent) => {
      if (e.key === "Shift" && keyboardSelecting) {
        keyboardSelecting = false;
        schedule();
      }
    };
    document.addEventListener("selectionchange", schedule);
    document.addEventListener("pointerdown", down);
    document.addEventListener("pointerup", up);
    document.addEventListener("pointercancel", cancel);
    document.addEventListener("scroll", reposition, true);
    document.addEventListener("keydown", key, true);
    document.addEventListener("keyup", keyUp, true);
    window.addEventListener("resize", reposition);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("selectionchange", schedule);
      document.removeEventListener("pointerdown", down);
      document.removeEventListener("pointerup", up);
      document.removeEventListener("pointercancel", cancel);
      document.removeEventListener("scroll", reposition, true);
      document.removeEventListener("keydown", key, true);
      document.removeEventListener("keyup", keyUp, true);
      window.removeEventListener("resize", reposition);
    };
  }, [root, clear, send, conversation?.workspace.snapshot.id]);
  if (!candidate || !conversation?.explainText) return null;
  return createPortal(
    <form
      ref={popover}
      className="text-selection-action"
      style={{ left: candidate.x, top: candidate.y, width: candidate.width }}
      role="dialog"
      aria-label={t("Ask AI about selected code")}
      aria-describedby={hintId}
      onSubmit={(event) => {
        event.preventDefault();
        send();
      }}
    >
      <div className="text-selection-question">
        <Sparkles size={16} aria-hidden />
        <input
          ref={input}
          autoFocus
          type="text"
          aria-label={t("Question about selected code")}
          aria-describedby={hintId}
          placeholder={t("Ask about this code…")}
          autoComplete="off"
          onKeyDown={(event) => {
            if (
              event.key === "Enter" &&
              (event.nativeEvent.isComposing ||
                event.nativeEvent.keyCode === 229)
            )
              event.preventDefault();
          }}
        />
        <button
          type="submit"
          className="primary text-selection-send"
          aria-label={t("Ask AI about selected code")}
          title={t("Send question · Enter")}
          disabled={conversation.isBusy(candidate.anchor)}
        >
          <ArrowUp size={16} aria-hidden />
        </button>
      </div>
      <span className="text-selection-hint" id={hintId}>
        {t("AI only · Leave blank to explain · Esc to dismiss")}
      </span>
    </form>,
    document.body,
  );
}
