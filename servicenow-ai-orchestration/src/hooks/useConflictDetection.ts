import { useState, useCallback } from 'react';
import { ServiceNowAPI } from '../services/servicenow';

interface ConflictState {
  hasConflict: boolean;
  localData: Record<string, unknown> | null;
  serverData: Record<string, unknown> | null;
}

interface ConflictCheckResult {
  hasConflict: boolean;
  serverData?: Record<string, unknown>;
}

export function useConflictDetection() {
  const [conflictState, setConflictState] = useState<ConflictState>({
    hasConflict: false,
    localData: null,
    serverData: null,
  });

  /**
   * Check for conflicts before updating a record
   * Compares the local sys_mod_count with the server's current value
   */
  const checkForConflict = useCallback(
    async (
      api: ServiceNowAPI,
      table: string,
      sysId: string,
      localRecord: Record<string, unknown>
    ): Promise<ConflictCheckResult> => {
      const localModCount = localRecord.sys_mod_count;

      // If we don't have a mod count, we can't detect conflicts
      if (localModCount === undefined) {
        return { hasConflict: false };
      }

      try {
        // Fetch the current record from the server
        const response = await api.get<Record<string, unknown>>(table, {
          sysparm_query: `sys_id=${sysId}`,
          sysparm_display_value: 'all',
          sysparm_limit: 1,
        });

        const serverRecord = response.result?.[0];
        if (!serverRecord) {
          return { hasConflict: false };
        }

        const serverModCount = serverRecord.sys_mod_count;

        // Compare mod counts
        // sys_mod_count can be a number or a string or a reference object
        const localCount = typeof localModCount === 'object'
          ? (localModCount as { value?: string }).value
          : String(localModCount);
        const serverCount = typeof serverModCount === 'object'
          ? (serverModCount as { value?: string }).value
          : String(serverModCount);

        if (localCount !== serverCount) {
          return {
            hasConflict: true,
            serverData: serverRecord,
          };
        }

        return { hasConflict: false };
      } catch {
        // If we can't check, proceed without conflict detection
        return { hasConflict: false };
      }
    },
    []
  );

  /**
   * Set conflict state to show the resolution modal
   */
  const setConflict = useCallback(
    (localData: Record<string, unknown>, serverData: Record<string, unknown>) => {
      setConflictState({
        hasConflict: true,
        localData,
        serverData,
      });
    },
    []
  );

  /**
   * Clear conflict state
   */
  const clearConflict = useCallback(() => {
    setConflictState({
      hasConflict: false,
      localData: null,
      serverData: null,
    });
  }, []);

  /**
   * Prepare update data with current sys_mod_count
   * This ensures the next update can be conflict-checked
   */
  const prepareUpdateData = useCallback(
    (data: Record<string, unknown>, serverModCount: unknown): Record<string, unknown> => {
      return {
        ...data,
        sys_mod_count: serverModCount,
      };
    },
    []
  );

  return {
    conflictState,
    checkForConflict,
    setConflict,
    clearConflict,
    prepareUpdateData,
  };
}
