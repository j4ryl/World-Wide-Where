import type { TimelineNode } from "@planit/shared-schema";
import { create } from "zustand";

type PlannerState = {
  selectedCardIds: string[];
  timelineNodes: TimelineNode[];
  toggleSelectedCard: (cardId: string) => void;
  setSelectedCardIds: (cardIds: string[]) => void;
  setTimelineNodes: (nodes: TimelineNode[]) => void;
  reorderTimeline: (nodes: TimelineNode[]) => void;
  reset: () => void;
};

export const usePlannerStore = create<PlannerState>((set) => ({
  selectedCardIds: [],
  timelineNodes: [],
  toggleSelectedCard: (cardId) =>
    set((state) => ({
      selectedCardIds: state.selectedCardIds.includes(cardId)
        ? state.selectedCardIds.filter((entry) => entry !== cardId)
        : [...state.selectedCardIds, cardId],
    })),
  setSelectedCardIds: (cardIds) =>
    set({
      selectedCardIds: cardIds,
    }),
  setTimelineNodes: (nodes) =>
    set({
      timelineNodes: nodes,
      selectedCardIds: nodes.map((node) => node.cardId),
    }),
  reorderTimeline: (nodes) =>
    set({
      timelineNodes: nodes,
      selectedCardIds: nodes.map((node) => node.cardId),
    }),
  reset: () =>
    set({
      selectedCardIds: [],
      timelineNodes: [],
    }),
}));
