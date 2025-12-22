import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { v4 as uuidv4 } from 'uuid';
import type {
  IngestionSession,
  APIRequest,
  AuditEntry,
  ExtractedData,
  RequestStatus,
} from '../types';

interface SessionState {
  sessions: IngestionSession[];
  currentSessionId: string | null;

  // Session management
  createSession: (fileName: string) => string;
  setCurrentSession: (sessionId: string | null) => void;
  updateSessionStatus: (sessionId: string, status: IngestionSession['status']) => void;
  deleteSession: (sessionId: string) => void;

  // Current session helpers
  getCurrentSession: () => IngestionSession | null;

  // Extracted data
  setExtractedData: (sessionId: string, data: ExtractedData) => void;
  updateExtractedData: (sessionId: string, data: Partial<ExtractedData>) => void;

  // Request management
  addRequest: (sessionId: string, request: Omit<APIRequest, 'id' | 'createdAt' | 'status'>) => string;
  updateRequest: (sessionId: string, requestId: string, updates: Partial<APIRequest>) => void;
  removeRequest: (sessionId: string, requestId: string) => void;
  reorderRequests: (sessionId: string, requestIds: string[]) => void;
  setRequestStatus: (sessionId: string, requestId: string, status: RequestStatus) => void;

  // Audit logging
  addAuditEntry: (sessionId: string, action: string, details: string, beforeValue?: unknown, afterValue?: unknown) => void;
}

export const useSessionStore = create<SessionState>()(
  persist(
    (set, get) => ({
      sessions: [],
      currentSessionId: null,

      createSession: (fileName: string) => {
        const id = uuidv4();
        const session: IngestionSession = {
          id,
          fileName,
          status: 'in_progress',
          createdAt: new Date(),
          updatedAt: new Date(),
          requests: [],
          auditLog: [],
        };

        set((state) => ({
          sessions: [session, ...state.sessions],
          currentSessionId: id,
        }));

        get().addAuditEntry(id, 'SESSION_CREATED', `Session created for file: ${fileName}`);
        return id;
      },

      setCurrentSession: (sessionId: string | null) => {
        set({ currentSessionId: sessionId });
      },

      updateSessionStatus: (sessionId: string, status: IngestionSession['status']) => {
        set((state) => ({
          sessions: state.sessions.map((s) =>
            s.id === sessionId
              ? { ...s, status, updatedAt: new Date() }
              : s
          ),
        }));
        get().addAuditEntry(sessionId, 'STATUS_CHANGED', `Session status changed to: ${status}`);
      },

      deleteSession: (sessionId: string) => {
        set((state) => ({
          sessions: state.sessions.filter((s) => s.id !== sessionId),
          currentSessionId:
            state.currentSessionId === sessionId ? null : state.currentSessionId,
        }));
      },

      getCurrentSession: () => {
        const state = get();
        if (!state.currentSessionId) return null;
        return state.sessions.find((s) => s.id === state.currentSessionId) || null;
      },

      setExtractedData: (sessionId: string, data: ExtractedData) => {
        set((state) => ({
          sessions: state.sessions.map((s) =>
            s.id === sessionId
              ? {
                  ...s,
                  extractedData: data,
                  documentType: data.documentType,
                  updatedAt: new Date(),
                }
              : s
          ),
        }));
        get().addAuditEntry(sessionId, 'DATA_EXTRACTED', `Extracted ${data.rawEntities.length} entities`);
      },

      updateExtractedData: (sessionId: string, data: Partial<ExtractedData>) => {
        set((state) => ({
          sessions: state.sessions.map((s) =>
            s.id === sessionId && s.extractedData
              ? {
                  ...s,
                  extractedData: { ...s.extractedData, ...data },
                  updatedAt: new Date(),
                }
              : s
          ),
        }));
      },

      addRequest: (sessionId: string, request: Omit<APIRequest, 'id' | 'createdAt' | 'status'>) => {
        const id = uuidv4();
        const newRequest: APIRequest = {
          ...request,
          id,
          status: 'pending',
          createdAt: new Date(),
        };

        set((state) => ({
          sessions: state.sessions.map((s) =>
            s.id === sessionId
              ? {
                  ...s,
                  requests: [...s.requests, newRequest],
                  updatedAt: new Date(),
                }
              : s
          ),
        }));

        get().addAuditEntry(
          sessionId,
          'REQUEST_ADDED',
          `Added ${request.method} request for ${request.entityType}`
        );
        return id;
      },

      updateRequest: (sessionId: string, requestId: string, updates: Partial<APIRequest>) => {
        const session = get().sessions.find((s) => s.id === sessionId);
        const oldRequest = session?.requests.find((r) => r.id === requestId);

        set((state) => ({
          sessions: state.sessions.map((s) =>
            s.id === sessionId
              ? {
                  ...s,
                  requests: s.requests.map((r) =>
                    r.id === requestId ? { ...r, ...updates } : r
                  ),
                  updatedAt: new Date(),
                }
              : s
          ),
        }));

        if (updates.body && oldRequest) {
          get().addAuditEntry(
            sessionId,
            'REQUEST_MODIFIED',
            `Modified request body for ${oldRequest.entityType}`,
            oldRequest.body,
            updates.body
          );
        }
      },

      removeRequest: (sessionId: string, requestId: string) => {
        const session = get().sessions.find((s) => s.id === sessionId);
        const request = session?.requests.find((r) => r.id === requestId);

        set((state) => ({
          sessions: state.sessions.map((s) =>
            s.id === sessionId
              ? {
                  ...s,
                  requests: s.requests.filter((r) => r.id !== requestId),
                  updatedAt: new Date(),
                }
              : s
          ),
        }));

        if (request) {
          get().addAuditEntry(
            sessionId,
            'REQUEST_REMOVED',
            `Removed ${request.method} request for ${request.entityType}`
          );
        }
      },

      reorderRequests: (sessionId: string, requestIds: string[]) => {
        set((state) => ({
          sessions: state.sessions.map((s) => {
            if (s.id !== sessionId) return s;
            const requestMap = new Map(s.requests.map((r) => [r.id, r]));
            const reorderedRequests = requestIds
              .map((id) => requestMap.get(id))
              .filter((r): r is APIRequest => r !== undefined);
            return {
              ...s,
              requests: reorderedRequests,
              updatedAt: new Date(),
            };
          }),
        }));
      },

      setRequestStatus: (sessionId: string, requestId: string, status: RequestStatus) => {
        set((state) => ({
          sessions: state.sessions.map((s) =>
            s.id === sessionId
              ? {
                  ...s,
                  requests: s.requests.map((r) =>
                    r.id === requestId
                      ? {
                          ...r,
                          status,
                          executedAt: status === 'success' || status === 'failed' ? new Date() : r.executedAt,
                        }
                      : r
                  ),
                  updatedAt: new Date(),
                }
              : s
          ),
        }));
      },

      addAuditEntry: (sessionId: string, action: string, details: string, beforeValue?: unknown, afterValue?: unknown) => {
        const entry: AuditEntry = {
          id: uuidv4(),
          timestamp: new Date(),
          action,
          details,
          beforeValue,
          afterValue,
        };

        set((state) => ({
          sessions: state.sessions.map((s) =>
            s.id === sessionId
              ? {
                  ...s,
                  auditLog: [...s.auditLog, entry],
                }
              : s
          ),
        }));
      },
    }),
    {
      name: 'servicenow-ai-sessions',
      // Serialize dates properly
      storage: {
        getItem: (name) => {
          const str = localStorage.getItem(name);
          if (!str) return null;
          const data = JSON.parse(str);
          // Rehydrate dates
          if (data.state?.sessions) {
            data.state.sessions = data.state.sessions.map((s: IngestionSession) => ({
              ...s,
              createdAt: new Date(s.createdAt),
              updatedAt: new Date(s.updatedAt),
              requests: s.requests.map((r) => ({
                ...r,
                createdAt: new Date(r.createdAt),
                executedAt: r.executedAt ? new Date(r.executedAt) : undefined,
              })),
              auditLog: s.auditLog.map((a) => ({
                ...a,
                timestamp: new Date(a.timestamp),
              })),
            }));
          }
          return data;
        },
        setItem: (name, value) => localStorage.setItem(name, JSON.stringify(value)),
        removeItem: (name) => localStorage.removeItem(name),
      },
    }
  )
);
