import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { DuplicatePair, DuplicateDetectionResult, DuplicateResolutionAction } from '../types';

interface DuplicateDetectionState {
  // Current scan result
  result: DuplicateDetectionResult;

  // Resolution history
  resolvedPairs: DuplicateResolutionAction[];

  // UI state
  selectedPairId: string | null;
  filterSeverity: 'all' | 'high' | 'medium' | 'low';
  sortBy: 'similarity' | 'severity' | 'vendor';

  // Actions
  startScan: () => void;
  completeScan: (pairs: DuplicatePair[], totalAnalyzed: number) => void;
  failScan: (error: string) => void;
  resetScan: () => void;

  // Pair management
  selectPair: (pairId: string | null) => void;
  resolvePair: (action: DuplicateResolutionAction) => void;
  undoResolution: (pairId: string) => void;

  // Filtering
  setFilterSeverity: (severity: 'all' | 'high' | 'medium' | 'low') => void;
  setSortBy: (sortBy: 'similarity' | 'severity' | 'vendor') => void;

  // Computed helpers
  getUnresolvedPairs: () => DuplicatePair[];
  getPairById: (pairId: string) => DuplicatePair | undefined;
}

const initialResult: DuplicateDetectionResult = {
  totalContractsAnalyzed: 0,
  duplicatePairsFound: 0,
  pairs: [],
  scanDate: new Date(),
  status: 'idle',
};

export const useDuplicateDetectionStore = create<DuplicateDetectionState>()(
  persist(
    (set, get) => ({
      result: initialResult,
      resolvedPairs: [],
      selectedPairId: null,
      filterSeverity: 'all',
      sortBy: 'severity',

      startScan: () =>
        set({
          result: {
            ...initialResult,
            status: 'scanning',
            scanDate: new Date(),
          },
        }),

      completeScan: (pairs, totalAnalyzed) =>
        set({
          result: {
            totalContractsAnalyzed: totalAnalyzed,
            duplicatePairsFound: pairs.length,
            pairs,
            scanDate: new Date(),
            status: 'complete',
          },
        }),

      failScan: (error) =>
        set((state) => ({
          result: {
            ...state.result,
            status: 'error',
            error,
          },
        })),

      resetScan: () =>
        set({
          result: initialResult,
          selectedPairId: null,
        }),

      selectPair: (pairId) =>
        set({ selectedPairId: pairId }),

      resolvePair: (action) =>
        set((state) => {
          // Check if already resolved
          const existing = state.resolvedPairs.find((r) => r.pairId === action.pairId);
          if (existing) {
            // Update existing resolution
            return {
              resolvedPairs: state.resolvedPairs.map((r) =>
                r.pairId === action.pairId ? action : r
              ),
            };
          }
          // Add new resolution
          return {
            resolvedPairs: [...state.resolvedPairs, action],
          };
        }),

      undoResolution: (pairId) =>
        set((state) => ({
          resolvedPairs: state.resolvedPairs.filter((r) => r.pairId !== pairId),
        })),

      setFilterSeverity: (severity) =>
        set({ filterSeverity: severity }),

      setSortBy: (sortBy) =>
        set({ sortBy }),

      getUnresolvedPairs: () => {
        const state = get();
        const resolvedIds = new Set(state.resolvedPairs.map((r) => r.pairId));
        return state.result.pairs.filter((p) => !resolvedIds.has(p.id));
      },

      getPairById: (pairId) => {
        const state = get();
        return state.result.pairs.find((p) => p.id === pairId);
      },
    }),
    {
      name: 'duplicate-detection-store',
      partialize: (state) => ({
        // Only persist resolutions, not scan results
        resolvedPairs: state.resolvedPairs,
        filterSeverity: state.filterSeverity,
        sortBy: state.sortBy,
      }),
    }
  )
);
