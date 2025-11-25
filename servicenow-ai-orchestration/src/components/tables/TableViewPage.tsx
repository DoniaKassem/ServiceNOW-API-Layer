import { useEffect, useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { RefreshCw, Clock } from 'lucide-react';
import { format } from 'date-fns';
import { DataTable } from './DataTable';
import { RecordDetailModal } from './RecordDetailModal';
import { RecordFormModal } from './RecordFormModal';
import { BulkEditModal } from './BulkEditModal';
import { DeleteConfirmModal } from './DeleteConfirmModal';
import { CloneRecordModal } from './CloneRecordModal';
import { CSVImportModal } from './CSVImportModal';
import { ConflictResolutionModal } from './ConflictResolutionModal';
import { BatchOperationModal, type BatchOperationType } from './BatchOperationModal';
import { RequestPreviewModal } from '../request-log/RequestPreviewModal';
import { useConflictDetection } from '../../hooks/useConflictDetection';
import { useTableViewStore } from '../../stores/tableViewStore';
import { useRequestLogStore } from '../../stores/requestLogStore';
import { useWorkflowStore } from '../../stores/workflowStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { ServiceNowAPI, getServiceNowAPI, initServiceNowAPI } from '../../services/servicenow';
import { TABLE_VIEW_CONFIG, type TableViewType } from '../../types';

interface TableViewPageProps {
  viewType: TableViewType;
}

export function TableViewPage({ viewType }: TableViewPageProps) {
  const queryClient = useQueryClient();
  const { settings } = useSettingsStore();
  const { addEntry, updateEntry } = useRequestLogStore();
  const { shouldAutoExecute, recordExecution, getWorkflow } = useWorkflowStore();
  const {
    currentPage,
    searchQuery,
    activeFilters,
    sortField,
    sortDirection,
    preferences,
    setCurrentView,
    getVisibleColumns,
    buildQueryString,
    discardAllChanges,
    clearSelection,
  } = useTableViewStore();

  // Modal states
  const [selectedRecord, setSelectedRecord] = useState<Record<string, unknown> | null>(null);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showBulkEditModal, setShowBulkEditModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showCloneModal, setShowCloneModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [showConflictModal, setShowConflictModal] = useState(false);
  const [showBatchModal, setShowBatchModal] = useState(false);
  const [batchOperation, setBatchOperation] = useState<{
    type: BatchOperationType;
    records: Record<string, unknown>[];
    updateData?: Record<string, unknown>;
  } | null>(null);
  const [showRequestPreview, setShowRequestPreview] = useState(false);
  const [pendingUpdate, setPendingUpdate] = useState<{
    sysId: string;
    data: Record<string, unknown>;
    originalRecord: Record<string, unknown>;
  } | null>(null);
  const [bulkEditIds, setBulkEditIds] = useState<string[]>([]);
  const [deleteIds, setDeleteIds] = useState<string[]>([]);
  const [pendingRequest, setPendingRequest] = useState<{
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
    url: string;
    headers: Record<string, string>;
    body?: Record<string, unknown>;
    onExecute: (modifiedBody?: Record<string, unknown>) => void;
  } | null>(null);

  const config = TABLE_VIEW_CONFIG[viewType];
  const pageSize = preferences[viewType].pageSize;

  // Conflict detection
  const { conflictState, checkForConflict, setConflict, clearConflict } = useConflictDetection();

  // Set current view on mount
  useEffect(() => {
    setCurrentView(viewType);
  }, [viewType, setCurrentView]);

  // Initialize API
  const getApi = useCallback((): ServiceNowAPI | null => {
    if (!settings.servicenow.apiKey || !settings.servicenow.instanceUrl) {
      return null;
    }
    try {
      return getServiceNowAPI(settings.servicenow.instanceUrl, settings.servicenow.apiKey);
    } catch {
      return initServiceNowAPI(settings.servicenow.instanceUrl, settings.servicenow.apiKey);
    }
  }, [settings.servicenow]);

  // Build query params
  const buildParams = useCallback(() => {
    const visibleColumns = getVisibleColumns(viewType);
    const fields = visibleColumns.map((c) => c.field).join(',');
    const query = buildQueryString();
    const baseQuery = config.defaultQuery ? `${config.defaultQuery}^${query}` : query;

    return {
      sysparm_query: baseQuery || undefined,
      sysparm_fields: `sys_id,${fields}`,
      sysparm_limit: pageSize,
      sysparm_offset: (currentPage - 1) * pageSize,
      sysparm_display_value: 'all',
    };
  }, [viewType, config, pageSize, currentPage, getVisibleColumns, buildQueryString]);

  // Calculate polling interval
  const pollingInterval = settings.polling?.enabled
    ? (settings.polling.interval || 30) * 1000
    : false;

  // Fetch data query with polling support
  const { data, isLoading, error, refetch, dataUpdatedAt, isFetching } = useQuery({
    queryKey: ['table', viewType, currentPage, searchQuery, activeFilters, sortField, sortDirection],
    queryFn: async () => {
      const api = getApi();
      if (!api) throw new Error('API not configured');

      const params = buildParams();
      const startTime = Date.now();
      const logId = addEntry({
        method: 'GET',
        url: `${settings.servicenow.instanceUrl}/api/now/table/${config.table}`,
        table: config.table,
        headers: {
          'Content-Type': 'application/json',
          'x-sn-apikey': settings.servicenow.apiKey,
        },
      });

      try {
        const response = await api.get<Record<string, unknown>>(config.table, params as any);
        const duration = Date.now() - startTime;

        // Get total count from headers or estimate
        const totalCount = response.result?.length || 0;

        updateEntry(logId, {
          responseStatus: 200,
          responseBody: response,
          duration,
        });

        const workflow = getWorkflow('GET', config.table);
        if (workflow) {
          recordExecution(workflow.id, true);
        }

        return {
          records: response.result || [],
          totalCount: totalCount < pageSize ? (currentPage - 1) * pageSize + totalCount : totalCount + pageSize,
        };
      } catch (err: any) {
        const duration = Date.now() - startTime;
        updateEntry(logId, {
          responseStatus: err.response?.status || 500,
          error: err.message,
          duration,
        });

        const workflow = getWorkflow('GET', config.table);
        if (workflow) {
          recordExecution(workflow.id, false);
        }

        throw err;
      }
    },
    enabled: !!settings.servicenow.apiKey,
    refetchInterval: pollingInterval,
    refetchIntervalInBackground: false, // Only poll when tab is focused
  });

  // Update mutation with optimistic updates and conflict detection
  const updateMutation = useMutation({
    mutationFn: async ({ sysId, data, originalRecord, skipConflictCheck }: {
      sysId: string;
      data: Record<string, unknown>;
      originalRecord?: Record<string, unknown>;
      skipConflictCheck?: boolean;
    }) => {
      const api = getApi();
      if (!api) throw new Error('API not configured');

      // Check for conflicts if we have an original record with sys_mod_count
      if (!skipConflictCheck && originalRecord?.sys_mod_count) {
        const conflictResult = await checkForConflict(api, config.table, sysId, originalRecord);
        if (conflictResult.hasConflict && conflictResult.serverData) {
          // Store the pending update and show conflict modal
          setPendingUpdate({ sysId, data, originalRecord });
          setConflict(data, conflictResult.serverData);
          setShowConflictModal(true);
          throw new Error('CONFLICT_DETECTED');
        }
      }

      const url = `${settings.servicenow.instanceUrl}/api/now/table/${config.table}/${sysId}`;
      const headers = {
        'Content-Type': 'application/json',
        'x-sn-apikey': settings.servicenow.apiKey,
      };

      // Check if we should auto-execute or show preview
      if (!shouldAutoExecute('PATCH', config.table)) {
        return new Promise((resolve, reject) => {
          setPendingRequest({
            method: 'PATCH',
            url,
            headers,
            body: data,
            onExecute: async (modifiedBody) => {
              try {
                const result = await executeUpdate(api, sysId, modifiedBody || data);
                resolve(result);
              } catch (err) {
                reject(err);
              }
            },
          });
          setShowRequestPreview(true);
        });
      }

      return executeUpdate(api, sysId, data);
    },
    // Optimistic update
    onMutate: async ({ sysId, data: newData }) => {
      // Cancel any outgoing refetches
      await queryClient.cancelQueries({ queryKey: ['table', viewType] });

      // Snapshot the previous value
      const previousData = queryClient.getQueryData(['table', viewType, currentPage, searchQuery, activeFilters, sortField, sortDirection]);

      // Optimistically update the cache
      queryClient.setQueryData(
        ['table', viewType, currentPage, searchQuery, activeFilters, sortField, sortDirection],
        (old: { records: Record<string, unknown>[]; totalCount: number } | undefined) => {
          if (!old) return old;
          return {
            ...old,
            records: old.records.map((record) =>
              record.sys_id === sysId ? { ...record, ...newData } : record
            ),
          };
        }
      );

      // Return context with the previous value
      return { previousData };
    },
    onError: (_err, _variables, context) => {
      // Rollback on error
      if (context?.previousData) {
        queryClient.setQueryData(
          ['table', viewType, currentPage, searchQuery, activeFilters, sortField, sortDirection],
          context.previousData
        );
      }
    },
    onSettled: () => {
      // Always refetch after error or success
      queryClient.invalidateQueries({ queryKey: ['table', viewType] });
    },
  });

  const executeUpdate = async (api: ServiceNowAPI, sysId: string, data: Record<string, unknown>) => {
    const startTime = Date.now();
    const logId = addEntry({
      method: 'PATCH',
      url: `${settings.servicenow.instanceUrl}/api/now/table/${config.table}/${sysId}`,
      table: config.table,
      recordSysId: sysId,
      headers: {
        'Content-Type': 'application/json',
        'x-sn-apikey': settings.servicenow.apiKey,
      },
      body: data,
    });

    try {
      const response = await api.update(config.table, sysId, data);
      const duration = Date.now() - startTime;

      updateEntry(logId, {
        responseStatus: 200,
        responseBody: response,
        duration,
      });

      const workflow = getWorkflow('PATCH', config.table);
      if (workflow) {
        recordExecution(workflow.id, true);
      }

      return response;
    } catch (err: any) {
      const duration = Date.now() - startTime;
      updateEntry(logId, {
        responseStatus: err.response?.status || 500,
        error: err.message,
        duration,
      });

      const workflow = getWorkflow('PATCH', config.table);
      if (workflow) {
        recordExecution(workflow.id, false);
      }

      throw err;
    }
  };

  // Delete mutation with optimistic updates
  const deleteMutation = useMutation({
    mutationFn: async (sysIds: string[]) => {
      const api = getApi();
      if (!api) throw new Error('API not configured');

      // Delete operations always require preview
      for (const sysId of sysIds) {
        await executeDelete(api, sysId);
      }
    },
    // Optimistic delete
    onMutate: async (sysIds) => {
      // Cancel any outgoing refetches
      await queryClient.cancelQueries({ queryKey: ['table', viewType] });

      // Snapshot the previous value
      const previousData = queryClient.getQueryData(['table', viewType, currentPage, searchQuery, activeFilters, sortField, sortDirection]);

      // Optimistically remove records from cache
      queryClient.setQueryData(
        ['table', viewType, currentPage, searchQuery, activeFilters, sortField, sortDirection],
        (old: { records: Record<string, unknown>[]; totalCount: number } | undefined) => {
          if (!old) return old;
          return {
            ...old,
            records: old.records.filter((record) => !sysIds.includes(record.sys_id as string)),
            totalCount: old.totalCount - sysIds.length,
          };
        }
      );

      return { previousData };
    },
    onError: (_err, _variables, context) => {
      // Rollback on error
      if (context?.previousData) {
        queryClient.setQueryData(
          ['table', viewType, currentPage, searchQuery, activeFilters, sortField, sortDirection],
          context.previousData
        );
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['table', viewType] });
      clearSelection();
    },
  });

  const executeDelete = async (api: ServiceNowAPI, sysId: string) => {
    const startTime = Date.now();
    const logId = addEntry({
      method: 'DELETE',
      url: `${settings.servicenow.instanceUrl}/api/now/table/${config.table}/${sysId}`,
      table: config.table,
      recordSysId: sysId,
      headers: {
        'Content-Type': 'application/json',
        'x-sn-apikey': settings.servicenow.apiKey,
      },
    });

    try {
      // ServiceNow may use active=false instead of DELETE
      const response = await api.update(config.table, sysId, { active: 'false' });
      const duration = Date.now() - startTime;

      updateEntry(logId, {
        responseStatus: 200,
        responseBody: response,
        duration,
      });

      return response;
    } catch (err: any) {
      const duration = Date.now() - startTime;
      updateEntry(logId, {
        responseStatus: err.response?.status || 500,
        error: err.message,
        duration,
      });
      throw err;
    }
  };

  // Handle save changes from inline editing
  const handleSaveChanges = useCallback(async (changes: Map<string, Record<string, unknown>>) => {
    for (const [sysId, data] of changes) {
      await updateMutation.mutateAsync({ sysId, data });
    }
    discardAllChanges();
  }, [updateMutation, discardAllChanges]);

  // Handle row click to open detail modal
  const handleRowClick = useCallback((row: Record<string, unknown>) => {
    setSelectedRecord(row);
    setShowDetailModal(true);
  }, []);

  // Handle create new record
  const handleCreateNew = useCallback(() => {
    setShowCreateModal(true);
  }, []);

  // Handle bulk delete
  const handleBulkDelete = useCallback((sysIds: string[]) => {
    setDeleteIds(sysIds);
    setShowDeleteModal(true);
  }, []);

  // Handle bulk edit
  const handleBulkEdit = useCallback((sysIds: string[]) => {
    setBulkEditIds(sysIds);
    setShowBulkEditModal(true);
  }, []);

  // Handle import
  const handleImport = useCallback(() => {
    setShowImportModal(true);
  }, []);

  // Handle export
  const handleExport = useCallback(async (format: 'csv' | 'xlsx' | 'json') => {
    const api = getApi();
    if (!api || !data) return;

    const records = data.records;

    if (format === 'json') {
      const blob = new Blob([JSON.stringify(records, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${viewType}-export.json`;
      a.click();
      URL.revokeObjectURL(url);
    } else if (format === 'csv') {
      const visibleColumns = getVisibleColumns(viewType);
      const headers = visibleColumns.map((c) => c.label).join(',');
      const rows = records.map((record: Record<string, unknown>) =>
        visibleColumns.map((col) => {
          const value = record[col.field];
          if (typeof value === 'object' && value !== null) {
            const refValue = value as { display_value?: string };
            return `"${refValue.display_value || ''}"`;
          }
          return `"${String(value || '').replace(/"/g, '""')}"`;
        }).join(',')
      );
      const csv = [headers, ...rows].join('\n');
      const blob = new Blob([csv], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${viewType}-export.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } else if (format === 'xlsx') {
      // For xlsx, we'd need a library like xlsx.js
      // For now, fall back to CSV
      handleExport('csv');
    }
  }, [data, viewType, getVisibleColumns, getApi]);

  // Handle conflict resolution
  const handleConflictResolve = useCallback(
    async (resolution: 'local' | 'server' | 'merge', mergedData?: Record<string, unknown>) => {
      if (!pendingUpdate) return;

      setShowConflictModal(false);
      clearConflict();

      if (resolution === 'server') {
        // Discard local changes, just refetch
        refetch();
      } else {
        // Apply local or merged changes, skip conflict check this time
        const dataToApply = resolution === 'merge' && mergedData ? mergedData : pendingUpdate.data;
        await updateMutation.mutateAsync({
          sysId: pendingUpdate.sysId,
          data: dataToApply,
          skipConflictCheck: true,
        });
      }

      setPendingUpdate(null);
    },
    [pendingUpdate, clearConflict, refetch, updateMutation]
  );

  // Confirm delete - use batch modal for multiple records
  const handleConfirmDelete = useCallback(async () => {
    if (deleteIds.length > 3) {
      // For many records, use batch operation with progress tracking
      const recordsToDelete = data?.records.filter((r) =>
        deleteIds.includes(r.sys_id as string)
      ) || [];

      setBatchOperation({
        type: 'delete',
        records: recordsToDelete,
      });
      setShowDeleteModal(false);
      setShowBatchModal(true);
    } else {
      // For few records, use quick delete
      await deleteMutation.mutateAsync(deleteIds);
      setShowDeleteModal(false);
      setDeleteIds([]);
    }
  }, [deleteMutation, deleteIds, data?.records]);

  // Handle batch operation complete
  const handleBatchComplete = useCallback(() => {
    setShowBatchModal(false);
    setBatchOperation(null);
    setDeleteIds([]);
    clearSelection();
    refetch();
  }, [clearSelection, refetch]);

  return (
    <div className="h-full flex flex-col bg-gray-50">
      {/* Page Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{config.label}</h1>
            <p className="text-sm text-gray-500 mt-1">
              Viewing records from {config.table}
            </p>
          </div>
          <div className="flex items-center gap-4">
            {/* Last Refreshed Indicator */}
            {settings.polling?.showLastRefreshed && dataUpdatedAt > 0 && (
              <div className="flex items-center gap-2 text-sm text-gray-500">
                <Clock className="w-4 h-4" />
                <span>
                  Last updated: {format(new Date(dataUpdatedAt), 'HH:mm:ss')}
                </span>
              </div>
            )}
            {/* Polling Status */}
            {settings.polling?.enabled && (
              <div className="flex items-center gap-2">
                <div className={`flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium ${
                  isFetching ? 'bg-blue-100 text-blue-700' : 'bg-green-100 text-green-700'
                }`}>
                  <RefreshCw className={`w-3 h-3 ${isFetching ? 'animate-spin' : ''}`} />
                  {isFetching ? 'Refreshing...' : `Auto-refresh: ${settings.polling.interval}s`}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Data Table */}
      <div className="flex-1 relative">
        <DataTable
          viewType={viewType}
          data={data?.records || []}
          totalCount={data?.totalCount || 0}
          isLoading={isLoading}
          error={error?.message}
          onRefresh={refetch}
          onRowClick={handleRowClick}
          onCreateNew={handleCreateNew}
          onBulkDelete={handleBulkDelete}
          onBulkEdit={handleBulkEdit}
          onSaveChanges={handleSaveChanges}
          onExport={handleExport}
          onImport={handleImport}
        />
      </div>

      {/* Detail Modal */}
      {showDetailModal && selectedRecord && (
        <RecordDetailModal
          viewType={viewType}
          record={selectedRecord}
          onClose={() => {
            setShowDetailModal(false);
            setSelectedRecord(null);
          }}
          onEdit={() => {
            setShowDetailModal(false);
            setShowEditModal(true);
          }}
          onDelete={() => {
            setShowDetailModal(false);
            setDeleteIds([selectedRecord.sys_id as string]);
            setShowDeleteModal(true);
          }}
          onClone={() => {
            setShowDetailModal(false);
            setShowCloneModal(true);
          }}
        />
      )}

      {/* Create Modal */}
      {showCreateModal && (
        <RecordFormModal
          viewType={viewType}
          mode="create"
          onClose={() => setShowCreateModal(false)}
          onSuccess={() => {
            setShowCreateModal(false);
            refetch();
          }}
        />
      )}

      {/* Edit Modal */}
      {showEditModal && selectedRecord && (
        <RecordFormModal
          viewType={viewType}
          mode="edit"
          record={selectedRecord}
          onClose={() => {
            setShowEditModal(false);
            setSelectedRecord(null);
          }}
          onSuccess={() => {
            setShowEditModal(false);
            setSelectedRecord(null);
            refetch();
          }}
        />
      )}

      {/* Bulk Edit Modal */}
      {showBulkEditModal && (
        <BulkEditModal
          viewType={viewType}
          sysIds={bulkEditIds}
          onClose={() => {
            setShowBulkEditModal(false);
            setBulkEditIds([]);
          }}
          onSuccess={() => {
            setShowBulkEditModal(false);
            setBulkEditIds([]);
            clearSelection();
            refetch();
          }}
        />
      )}

      {/* Clone Modal */}
      {showCloneModal && selectedRecord && (
        <CloneRecordModal
          viewType={viewType}
          record={selectedRecord}
          onClose={() => {
            setShowCloneModal(false);
            setSelectedRecord(null);
          }}
          onSuccess={(newRecord) => {
            setShowCloneModal(false);
            setSelectedRecord(newRecord);
            setShowDetailModal(true);
            refetch();
          }}
        />
      )}

      {/* CSV Import Modal */}
      {showImportModal && (
        <CSVImportModal
          viewType={viewType}
          onClose={() => setShowImportModal(false)}
          onSuccess={() => {
            setShowImportModal(false);
            refetch();
          }}
        />
      )}

      {/* Conflict Resolution Modal */}
      {showConflictModal && conflictState.localData && conflictState.serverData && (
        <ConflictResolutionModal
          viewType={viewType}
          localData={conflictState.localData}
          serverData={conflictState.serverData}
          onResolve={handleConflictResolve}
          onCancel={() => {
            setShowConflictModal(false);
            clearConflict();
            setPendingUpdate(null);
          }}
        />
      )}

      {/* Batch Operation Modal */}
      {showBatchModal && batchOperation && (
        <BatchOperationModal
          viewType={viewType}
          operation={batchOperation.type}
          records={batchOperation.records}
          updateData={batchOperation.updateData}
          onClose={() => {
            setShowBatchModal(false);
            setBatchOperation(null);
          }}
          onComplete={handleBatchComplete}
        />
      )}

      {/* Delete Confirm Modal */}
      {showDeleteModal && (
        <DeleteConfirmModal
          viewType={viewType}
          sysIds={deleteIds}
          onClose={() => {
            setShowDeleteModal(false);
            setDeleteIds([]);
          }}
          onConfirm={handleConfirmDelete}
          isDeleting={deleteMutation.isPending}
        />
      )}

      {/* Request Preview Modal */}
      {showRequestPreview && pendingRequest && (
        <RequestPreviewModal
          isOpen={showRequestPreview}
          onClose={() => {
            setShowRequestPreview(false);
            setPendingRequest(null);
          }}
          onExecute={(modifiedBody) => {
            pendingRequest.onExecute(modifiedBody);
            setShowRequestPreview(false);
            setPendingRequest(null);
          }}
          method={pendingRequest.method}
          url={pendingRequest.url}
          headers={pendingRequest.headers}
          body={pendingRequest.body}
          table={config.table}
        />
      )}
    </div>
  );
}
