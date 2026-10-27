import { createContext, useContext } from "react";
import type { GuideIndexEntry } from "../lib/guideIndex";

export type GuideJump = { entry: GuideIndexEntry; sequence: number };
export const GuideJumpContext = createContext<GuideJump | null>(null);
export function useGuideJump(hunkIds?: string[]) {
  const jump = useContext(GuideJumpContext);
  return jump?.entry.anchor &&
    (!hunkIds || hunkIds.includes(jump.entry.anchor.hunkId))
    ? jump
    : null;
}
