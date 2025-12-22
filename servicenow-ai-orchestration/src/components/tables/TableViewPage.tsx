import { useEffect, useState, useCallback, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { RefreshCw, Clock, Link2, Table, Calendar, FileText, GitMerge } from 'lucide-react';
import { format } from 'date-fns';
import { DataTable } from './DataTable';
import { POPrintoutGenerator } from './POPrintoutGenerator';
import { ContractRenewalView } from './ContractRenewalView';
import { RecordDetailModal } from './RecordDetailModal';
import { RecordFormModal } from './RecordFormModal';
import { BulkEditModal } from './BulkEditModal';
import { DeleteConfirmModal } from './DeleteConfirmModal';
import { CloneRecordModal } from './CloneRecordModal';
import { CSVImportModal } from './CSVImportModal';
import { ConflictResolutionModal } from './ConflictResolutionModal';
import { BatchOperationModal, type BatchOperationType } from './BatchOperationModal';
import { AutoCreateSupplierModal } from './AutoCreateSupplierModal';
import { AutoCreateVendorModal } from './AutoCreateVendorModal';
import { SupplierDeduplicationTool } from './SupplierDeduplicationTool';
import { VendorDeduplicationTool } from './VendorDeduplicationTool';
import { RequestPreviewModal } from '../request-log/RequestPreviewModal';
import { useConflictDetection } from '../../hooks/useConflictDetection';
import { useToast } from '../ui';
import { useTableViewStore } from '../../stores/tableViewStore';
import { useRequestLogStore } from '../../stores/requestLogStore';
import { useWorkflowStore } from '../../stores/workflowStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { ServiceNowAPI, getServiceNowAPI, initServiceNowAPI } from '../../services/servicenow';
import { TABLE_VIEW_CONFIG, type TableViewType } from '../../types';
import { getFieldMetadata } from '../../config/fieldMetadata';
import { exportToExcel, type ExcelColumnType } from '../../utils/excelExport';
import { getSysId } from '../../utils/serviceNowHelpers';

interface TableViewPageProps {
  viewType: TableViewType;
}

export function TableViewPage({ viewType }: TableViewPageProps) {
  const queryClient = useQueryClient();
  const toast = useToast();
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
  const [showAutoSupplierModal, setShowAutoSupplierModal] = useState(false);
  const [showAutoVendorModal, setShowAutoVendorModal] = useState(false);
  const [showSupplierDedup, setShowSupplierDedup] = useState(false);
  const [showVendorDedup, setShowVendorDedup] = useState(false);
  const [showPOGenerator, setShowPOGenerator] = useState(false);
  const [selectedPOForPrintout, setSelectedPOForPrintout] = useState<string | undefined>(undefined);
  const [activeView, setActiveView] = useState<'table' | 'renewal'>('table');

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

  const visibleColumnFields = useMemo(() => {
    return getVisibleColumns(viewType).map((c) => c.field).join(',');
  }, [getVisibleColumns, viewType, preferences]);

  const baseQuery = useMemo(() => {
    const query = buildQueryString();
    return config.defaultQuery ? `${config.defaultQuery}^${query}` : query;
  }, [buildQueryString, config.defaultQuery, searchQuery, activeFilters, sortField, sortDirection]);

  // Stable React Query cache key for this table view
  const tableQueryKey = useMemo(
    () => ['table', viewType, currentPage, pageSize, baseQuery, visibleColumnFields] as const,
    [viewType, currentPage, pageSize, baseQuery, visibleColumnFields]
  );

  // Build query params
  const buildParams = useCallback(() => {
    return {
      sysparm_query: baseQuery || undefined,
      sysparm_fields: `sys_id,${visibleColumnFields}`,
      sysparm_limit: pageSize,
      sysparm_offset: (currentPage - 1) * pageSize,
      sysparm_display_value: 'all',
    };
  }, [baseQuery, visibleColumnFields, pageSize, currentPage]);

  // Calculate polling interval
  const pollingInterval = settings.polling?.enabled
    ? (settings.polling.interval || 30) * 1000
    : false;

  // Fetch data query with polling support
  const { data, isLoading, error, refetch, dataUpdatedAt, isFetching } = useQuery({
    queryKey: tableQueryKey,
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
    enabled: Boolean(settings.servicenow.apiKey && settings.servicenow.instanceUrl),
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
      const previousData = queryClient.getQueryData(tableQueryKey);

      // Optimistically update the cache
      queryClient.setQueryData(
        tableQueryKey,
        (old: { records: Record<string, unknown>[]; totalCount: number } | undefined) => {
          if (!old) return old;
          return {
            ...old,
            records: old.records.map((record) =>
              getSysId(record.sys_id) === sysId ? { ...record, ...newData } : record
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
        queryClient.setQueryData(tableQueryKey, context.previousData);
      }
    },
    onSuccess: () => {
      toast.success('Record Updated', 'The record has been successfully updated.');
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
      const previousData = queryClient.getQueryData(tableQueryKey);

      // Optimistically remove records from cache
      queryClient.setQueryData(
        tableQueryKey,
        (old: { records: Record<string, unknown>[]; totalCount: number } | undefined) => {
          if (!old) return old;
          return {
            ...old,
            records: old.records.filter((record) => !sysIds.includes(getSysId(record.sys_id))),
            totalCount: old.totalCount - sysIds.length,
          };
        }
      );

      return { previousData };
    },
    onError: (_err, _variables, context) => {
      // Rollback on error
      if (context?.previousData) {
        queryClient.setQueryData(tableQueryKey, context.previousData);
      }
    },
    onSuccess: (_data, variables) => {
      toast.success(
        'Records Deleted',
        `${variables.length} record${variables.length !== 1 ? 's' : ''} deleted successfully.`
      );
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
      // Use actual DELETE request to remove the record from ServiceNow
      await api.delete(config.table, sysId);
      const duration = Date.now() - startTime;

      updateEntry(logId, {
        responseStatus: 204,
        responseBody: { message: 'Record deleted successfully' },
        duration,
      });

      return { success: true };
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
      try {
        const visibleColumns = getVisibleColumns(viewType);

        const mapMetadataTypeToExcelType = (t?: string): ExcelColumnType | undefined => {
          switch (t) {
            case 'date':
              return 'date';
            case 'datetime':
              return 'datetime';
            case 'currency':
              return 'currency';
            case 'integer':
            case 'decimal':
              return 'number';
            case 'boolean':
              return 'boolean';
            case 'reference':
              return 'reference';
            default:
              return undefined;
          }
        };

        const guessExcelTypeFromFieldName = (field: string): ExcelColumnType | undefined => {
          const f = field.toLowerCase();

          // Dates commonly used in these table views
          if (['starts', 'ends', 'created', 'ordered', 'received', 'expected_delivery'].includes(f)) return 'date';

          // Currency-ish fields
          if (f.includes('amount') || f.includes('cost') || f.includes('total') || f.includes('price')) return 'currency';

          // Boolean-ish fields
          if (f === 'active' || f === 'renewable') return 'boolean';

          return undefined;
        };

        await exportToExcel({
          filename: `${viewType}-export`,
          sheetName: config.label,
          columns: visibleColumns.map((col) => {
            const meta = getFieldMetadata(viewType, col.field);
            const excelType =
              (col.type as ExcelColumnType | undefined) ??
              mapMetadataTypeToExcelType(meta?.type) ??
              guessExcelTypeFromFieldName(col.field);

            return {
              field: col.field,
              label: col.label,
              type: excelType,
            };
          }),
          data: records,
        });
        toast.success('Export Complete', `${records.length} records exported to Excel.`);
      } catch (err) {
        toast.error('Export Failed', (err as Error).message);
      }
    }
  }, [data, viewType, getVisibleColumns, getApi, config.label, toast]);

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
        deleteIds.includes(getSysId(r.sys_id))
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
            {/* View Toggle (only for contracts) */}
            {viewType === 'contracts' && (
              <div className="flex items-center bg-gray-100 rounded-lg p-1">
                <button
                  onClick={() => setActiveView('table')}
                  className={`flex items-center gap-2 px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                    activeView === 'table'
                      ? 'bg-white text-gray-900 shadow-sm'
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  <Table className="w-4 h-4" />
                  Table View
                </button>
                <button
                  onClick={() => setActiveView('renewal')}
                  className={`flex items-center gap-2 px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                    activeView === 'renewal'
                      ? 'bg-white text-gray-900 shadow-sm'
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  <Calendar className="w-4 h-4" />
                  Renewal View
                </button>
              </div>
            )}
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
            {/* PO Generator Button (only for purchase orders) */}
            {viewType === 'purchase_orders' && (
              <button
                onClick={() => setShowPOGenerator(true)}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
              >
                <FileText className="w-4 h-4" />
                Generate PO Printout
              </button>
            )}
            {/* Supplier Buttons */}
            {viewType === 'suppliers' && data?.records && data.records.length > 0 && (
              <>
                <button
                  onClick={() => setShowAutoVendorModal(true)}
                  className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-green-700 bg-green-100 hover:bg-green-200 rounded-lg transition-colors"
                >
                  <Link2 className="w-4 h-4" />
                  Auto-Create Vendors
                </button>
                <button
                  onClick={() => setShowSupplierDedup(true)}
                  className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-purple-600 hover:bg-purple-700 rounded-lg transition-colors"
                >
                  <GitMerge className="w-4 h-4" />
                  Deduplicate Suppliers
                </button>
              </>
            )}
            {/* Vendor Buttons */}
            {viewType === 'vendors' && data?.records && data.records.length > 0 && (
              <button
                onClick={() => setShowVendorDedup(true)}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
              >
                <GitMerge className="w-4 h-4" />
                Deduplicate Vendors
              </button>
            )}
            {/* Auto-Create Suppliers Button (only for contracts in table view) */}
            {viewType === 'contracts' && activeView === 'table' && data?.records && data.records.length > 0 && (
              <button
                onClick={() => setShowAutoSupplierModal(true)}
                className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-orange-700 bg-orange-100 hover:bg-orange-200 rounded-lg transition-colors"
              >
                <Link2 className="w-4 h-4" />
                Auto-Create Suppliers
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Data Table or Renewal View */}
      <div className="flex-1 relative">
        {viewType === 'contracts' && activeView === 'renewal' ? (
          <ContractRenewalView
            onContractClick={handleRowClick}
            onRefresh={refetch}
          />
        ) : (
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
        )}
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
            setDeleteIds([getSysId(selectedRecord.sys_id)]);
            setShowDeleteModal(true);
          }}
          onClone={() => {
            setShowDetailModal(false);
            setShowCloneModal(true);
          }}
          onGeneratePrintout={viewType === 'purchase_orders' ? () => {
            setShowDetailModal(false);
            setSelectedPOForPrintout(getSysId(selectedRecord.sys_id));
            setShowPOGenerator(true);
          } : undefined}
          onRecordUpdated={(updatedRecord) => {
            setSelectedRecord(updatedRecord);
            refetch();
            toast.success('Record Updated', 'Contract updated from document successfully.');
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

      {/* Auto-Create Supplier Modal */}
      {showAutoSupplierModal && data?.records && (
        <AutoCreateSupplierModal
          contracts={data.records}
          onClose={() => setShowAutoSupplierModal(false)}
          onSuccess={() => {
            setShowAutoSupplierModal(false);
            refetch();
            toast.success('Suppliers Created', 'Missing suppliers have been created and linked to contracts.');
          }}
        />
      )}

      {/* Auto-Create Vendor Modal */}
      {showAutoVendorModal && data?.records && (
        <AutoCreateVendorModal
          suppliers={data.records}
          onClose={() => setShowAutoVendorModal(false)}
          onSuccess={() => {
            setShowAutoVendorModal(false);
            refetch();
            toast.success('Vendors Created', 'Missing vendors have been created and linked to suppliers.');
          }}
        />
      )}

      {/* Supplier Deduplication Tool */}
      {showSupplierDedup && (
        <SupplierDeduplicationTool
          onClose={() => {
            setShowSupplierDedup(false);
            refetch();
          }}
        />
      )}

      {/* Vendor Deduplication Tool */}
      {showVendorDedup && (
        <VendorDeduplicationTool
          onClose={() => {
            setShowVendorDedup(false);
            refetch();
          }}
        />
      )}

      {/* PO Printout Generator */}
      {showPOGenerator && (
        <POPrintoutGenerator
          onClose={() => {
            setShowPOGenerator(false);
            setSelectedPOForPrintout(undefined);
          }}
          purchaseOrderSysId={selectedPOForPrintout}
        />
      )}
    </div>
  );
}
