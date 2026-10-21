import { useLayoutEffect, useRef } from "react";

export function useConversationScroll(messageCount: number, stream: string) {
  const ref = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  useLayoutEffect(() => {
    if (following.current && ref.current)
      ref.current.scrollTop = ref.current.scrollHeight;
  }, [messageCount, stream]);
  return {
    ref,
    onScroll: () => {
      const el = ref.current;
      if (el)
        following.current =
          el.scrollHeight - el.clientHeight - el.scrollTop < 48;
    },
  };
}
