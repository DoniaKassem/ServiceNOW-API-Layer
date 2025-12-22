import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { v4 as uuidv4 } from 'uuid';
import type { RequestLogEntry, RequestMethod } from '../types';

interface RequestLogState {
  entries: RequestLogEntry[];
  maxEntries: number;
  isPanelOpen: boolean;

  // Log management
  addEntry: (entry: Omit<RequestLogEntry, 'id' | 'timestamp'>) => string;
  updateEntry: (id: string, updates: Partial<RequestLogEntry>) => void;
  clearLog: () => void;
  removeEntry: (id: string) => void;

  // Panel state
  setIsPanelOpen: (isOpen: boolean) => void;
  togglePanel: () => void;

  // Filtering helpers
  getEntriesByMethod: (method: RequestMethod) => RequestLogEntry[];
  getEntriesByTable: (table: string) => RequestLogEntry[];
  getEntriesByStatus: (status: number) => RequestLogEntry[];
  getEntriesByDateRange: (start: Date, end: Date) => RequestLogEntry[];
  searchEntries: (query: string) => RequestLogEntry[];
}

const MAX_LOG_ENTRIES = 100; // Reduced to prevent localStorage quota issues

// Helper to truncate data before storing
function truncateForStorage(entry: RequestLogEntry): RequestLogEntry {
  const maxBodySize = 2000;

  const truncateValue = (value: unknown): unknown => {
    if (!value) return value;
    const str = typeof value === 'string' ? value : JSON.stringify(value);
    if (str.length > maxBodySize) {
      return { _truncated: true, _preview: str.slice(0, maxBodySize) + '...' };
    }
    return value;
  };

  return {
    ...entry,
    body: truncateValue(entry.body) as Record<string, unknown> | undefined,
    responseBody: truncateValue(entry.responseBody) as Record<string, unknown> | undefined,
  };
}

export const useRequestLogStore = create<RequestLogState>()(
  persist(
    (set, get) => ({
      entries: [],
      maxEntries: MAX_LOG_ENTRIES,
      isPanelOpen: false,

      addEntry: (entry) => {
        const id = uuidv4();

        // Never persist raw secrets (API keys / auth headers) to localStorage
        const safeEntry: Omit<RequestLogEntry, 'id' | 'timestamp'> = {
          ...entry,
          headers: maskSensitiveHeaders(entry.headers),
        };

        const newEntry: RequestLogEntry = {
          ...safeEntry,
          id,
          timestamp: new Date(),
        };

        set((state) => {
          const entries = [newEntry, ...state.entries];
          // Keep only the last maxEntries
          if (entries.length > state.maxEntries) {
            entries.splice(state.maxEntries);
          }
          return { entries };
        });

        return id;
      },

      updateEntry: (id, updates) => {
        // Ensure sensitive headers are never stored when updates include headers
        const safeUpdates: Partial<RequestLogEntry> = {
          ...updates,
          headers: updates.headers ? maskSensitiveHeaders(updates.headers) : updates.headers,
        };

        set((state) => ({
          entries: state.entries.map((entry) =>
            entry.id === id ? { ...entry, ...safeUpdates } : entry
          ),
        }));
      },

      clearLog: () => set({ entries: [] }),

      removeEntry: (id) => {
        set((state) => ({
          entries: state.entries.filter((entry) => entry.id !== id),
        }));
      },

      setIsPanelOpen: (isOpen) => set({ isPanelOpen: isOpen }),

      togglePanel: () => set((state) => ({ isPanelOpen: !state.isPanelOpen })),

      getEntriesByMethod: (method) => {
        return get().entries.filter((entry) => entry.method === method);
      },

      getEntriesByTable: (table) => {
        return get().entries.filter((entry) => entry.table === table);
      },

      getEntriesByStatus: (status) => {
        return get().entries.filter((entry) => entry.responseStatus === status);
      },

      getEntriesByDateRange: (start, end) => {
        return get().entries.filter((entry) => {
          const timestamp = new Date(entry.timestamp);
          return timestamp >= start && timestamp <= end;
        });
      },

      searchEntries: (query) => {
        const lowerQuery = query.toLowerCase();
        return get().entries.filter((entry) => {
          const urlMatch = entry.url.toLowerCase().includes(lowerQuery);
          const bodyMatch = entry.body
            ? JSON.stringify(entry.body).toLowerCase().includes(lowerQuery)
            : false;
          const responseMatch = entry.responseBody
            ? JSON.stringify(entry.responseBody).toLowerCase().includes(lowerQuery)
            : false;
          return urlMatch || bodyMatch || responseMatch;
        });
      },
    }),
    {
      name: 'servicenow-request-log',
      storage: {
        getItem: (name) => {
          try {
            const str = localStorage.getItem(name);
            if (!str) return null;
            const data = JSON.parse(str);
            // Rehydrate dates
            if (data.state?.entries) {
              data.state.entries = data.state.entries.map((e: RequestLogEntry) => ({
                ...e,
                timestamp: new Date(e.timestamp),
              }));
            }
            return data;
          } catch (error) {
            console.warn('Error loading request log from localStorage:', error);
            localStorage.removeItem(name);
            return null;
          }
        },
        setItem: (name, value) => {
          try {
            // Truncate entries before storing to save space
            const data = typeof value === 'string' ? JSON.parse(value) : value;
            if (data.state?.entries) {
              // Keep only most recent 50 entries for storage and truncate bodies
              data.state.entries = data.state.entries
                .slice(0, 50)
                .map(truncateForStorage);
            }
            localStorage.setItem(name, JSON.stringify(data));
          } catch (error) {
            if (error instanceof DOMException && error.name === 'QuotaExceededError') {
              console.warn('localStorage quota exceeded, clearing request log');
              // Clear the log and try again with minimal data
              try {
                localStorage.removeItem(name);
                const minimalData = {
                  state: { entries: [], maxEntries: MAX_LOG_ENTRIES, isPanelOpen: false },
                  version: 0
                };
                localStorage.setItem(name, JSON.stringify(minimalData));
              } catch {
                // If still failing, just don't persist
                console.warn('Could not persist request log');
              }
            } else {
              console.warn('Error saving request log to localStorage:', error);
            }
          }
        },
        removeItem: (name) => localStorage.removeItem(name),
      },
    }
  )
);

// Helper function to mask sensitive header values
export function maskSensitiveHeaders(headers: Record<string, string>): Record<string, string> {
  const sensitiveKeys = ['x-sn-apikey', 'authorization', 'api-key', 'apikey'];
  const masked: Record<string, string> = {};

  for (const [key, value] of Object.entries(headers)) {
    if (sensitiveKeys.includes(key.toLowerCase())) {
      masked[key] = value ? '****' + value.slice(-4) : '****';
    } else {
      masked[key] = value;
    }
  }

  return masked;
}

// Helper function to truncate large response bodies
export function truncateResponseBody(body: unknown, maxLength: number = 5000): unknown {
  if (typeof body === 'string' && body.length > maxLength) {
    return body.slice(0, maxLength) + '... [truncated]';
  }
  if (typeof body === 'object' && body !== null) {
    const stringified = JSON.stringify(body);
    if (stringified.length > maxLength) {
      return { _truncated: true, _preview: stringified.slice(0, maxLength) };
    }
  }
  return body;
}

// Helper to generate cURL command from a log entry
export function generateCurlCommand(entry: RequestLogEntry): string {
  const parts = [`curl -X ${entry.method}`];

  for (const [key, value] of Object.entries(entry.headers)) {
    const displayValue = ['x-sn-apikey', 'authorization'].includes(key.toLowerCase())
      ? '$API_KEY'
      : value;
    parts.push(`-H "${key}: ${displayValue}"`);
  }

  if (entry.body && Object.keys(entry.body).length > 0) {
    parts.push(`-d '${JSON.stringify(entry.body)}'`);
  }

  parts.push(`"${entry.url}"`);

  return parts.join(' \\\n  ');
}
