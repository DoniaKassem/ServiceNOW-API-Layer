import { useEffect, useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { DataTable } from './DataTable';
import { RecordDetailModal } from './RecordDetailModal';
import { RecordFormModal } from './RecordFormModal';
import { BulkEditModal } from './BulkEditModal';
import { DeleteConfirmModal } from './DeleteConfirmModal';
import { RequestPreviewModal } from '../request-log/RequestPreviewModal';
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
  const [showRequestPreview, setShowRequestPreview] = useState(false);
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

  // Fetch data query
  const { data, isLoading, error, refetch } = useQuery({
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
  });

  // Update mutation
  const updateMutation = useMutation({
    mutationFn: async ({ sysId, data }: { sysId: string; data: Record<string, unknown> }) => {
      const api = getApi();
      if (!api) throw new Error('API not configured');

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
    onSuccess: () => {
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

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: async (sysIds: string[]) => {
      const api = getApi();
      if (!api) throw new Error('API not configured');

      // Delete operations always require preview
      for (const sysId of sysIds) {
        await executeDelete(api, sysId);
      }
    },
    onSuccess: () => {
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

  // Confirm delete
  const handleConfirmDelete = useCallback(async () => {
    await deleteMutation.mutateAsync(deleteIds);
    setShowDeleteModal(false);
    setDeleteIds([]);
  }, [deleteMutation, deleteIds]);

  return (
    <div className="h-full flex flex-col bg-gray-50">
      {/* Page Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <h1 className="text-2xl font-bold text-gray-900">{config.label}</h1>
        <p className="text-sm text-gray-500 mt-1">
          Viewing records from {config.table}
        </p>
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
