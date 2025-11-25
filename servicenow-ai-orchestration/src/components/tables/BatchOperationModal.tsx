import { useState } from 'react';
import {
  X,
  Play,
  Pause,
  XCircle,
  CheckCircle,
  AlertCircle,
  Loader2,
  RefreshCw,
  Trash2,
  Edit3,
} from 'lucide-react';
import { clsx } from 'clsx';
import { useSettingsStore } from '../../stores/settingsStore';
import { useRequestLogStore } from '../../stores/requestLogStore';
import { getServiceNowAPI, initServiceNowAPI } from '../../services/servicenow';
import { TABLE_VIEW_CONFIG, type TableViewType } from '../../types';

export type BatchOperationType = 'update' | 'delete';

interface BatchOperationModalProps {
  viewType: TableViewType;
  operation: BatchOperationType;
  records: Record<string, unknown>[];
  updateData?: Record<string, unknown>; // For update operations
  onClose: () => void;
  onComplete: (results: BatchResult) => void;
}

interface BatchResult {
  total: number;
  successful: number;
  failed: number;
  errors: { sysId: string; message: string }[];
}

interface RecordStatus {
  sysId: string;
  displayName: string;
  status: 'pending' | 'in_progress' | 'success' | 'error';
  error?: string;
}

export function BatchOperationModal({
  viewType,
  operation,
  records,
  updateData,
  onClose,
  onComplete,
}: BatchOperationModalProps) {
  const { settings } = useSettingsStore();
  const { addEntry, updateEntry } = useRequestLogStore();
  const config = TABLE_VIEW_CONFIG[viewType];

  // State
  const [isRunning, setIsRunning] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [isCancelled, setIsCancelled] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [recordStatuses, setRecordStatuses] = useState<RecordStatus[]>(() =>
    records.map((record) => ({
      sysId: record.sys_id as string,
      displayName: getDisplayName(record),
      status: 'pending' as const,
    }))
  );

  function getDisplayName(record: Record<string, unknown>): string {
    return (record.name || record.number || record.display_name || record.sys_id) as string;
  }

  const getApi = () => {
    try {
      return getServiceNowAPI(settings.servicenow.instanceUrl, settings.servicenow.apiKey);
    } catch {
      return initServiceNowAPI(settings.servicenow.instanceUrl, settings.servicenow.apiKey);
    }
  };

  // Calculate progress
  const completed = recordStatuses.filter((r) => r.status === 'success' || r.status === 'error').length;
  const successful = recordStatuses.filter((r) => r.status === 'success').length;
  const failed = recordStatuses.filter((r) => r.status === 'error').length;
  const progress = (completed / records.length) * 100;

  // Execute a single operation
  const executeOperation = async (record: Record<string, unknown>): Promise<{ success: boolean; error?: string }> => {
    const api = getApi();
    const sysId = record.sys_id as string;
    const startTime = Date.now();

    const logId = addEntry({
      method: operation === 'delete' ? 'DELETE' : 'PATCH',
      url: `${settings.servicenow.instanceUrl}/api/now/table/${config.table}/${sysId}`,
      table: config.table,
      recordSysId: sysId,
      headers: {
        'Content-Type': 'application/json',
        'x-sn-apikey': settings.servicenow.apiKey,
      },
      body: operation === 'update' ? updateData : undefined,
    });

    try {
      if (operation === 'delete') {
        // Soft delete - set active to false
        await api.update(config.table, sysId, { active: 'false' });
      } else if (operation === 'update' && updateData) {
        await api.update(config.table, sysId, updateData);
      }

      const duration = Date.now() - startTime;
      updateEntry(logId, {
        responseStatus: 200,
        duration,
      });

      return { success: true };
    } catch (err: unknown) {
      const duration = Date.now() - startTime;
      const error = err as { response?: { status?: number }; message?: string };

      updateEntry(logId, {
        responseStatus: error.response?.status || 500,
        error: error.message,
        duration,
      });

      return { success: false, error: error.message || 'Unknown error' };
    }
  };

  // Process batch
  const processBatch = async () => {
    setIsRunning(true);
    setIsCancelled(false);

    for (let i = currentIndex; i < records.length; i++) {
      // Check if paused or cancelled
      if (isPaused) {
        setCurrentIndex(i);
        return;
      }
      if (isCancelled) {
        setCurrentIndex(i);
        setIsRunning(false);
        return;
      }

      const record = records[i];
      const sysId = record.sys_id as string;

      // Update status to in_progress
      setRecordStatuses((prev) =>
        prev.map((r) =>
          r.sysId === sysId ? { ...r, status: 'in_progress' as const } : r
        )
      );

      // Execute operation
      const result = await executeOperation(record);

      // Update status
      setRecordStatuses((prev) =>
        prev.map((r) =>
          r.sysId === sysId
            ? { ...r, status: result.success ? 'success' as const : 'error' as const, error: result.error }
            : r
        )
      );

      // Small delay to avoid overwhelming the API
      await new Promise((resolve) => setTimeout(resolve, 200));
    }

    setIsRunning(false);
    setCurrentIndex(records.length);

    // Calculate final results
    const finalStatuses = recordStatuses.map((r) => {
      const record = records.find((rec) => rec.sys_id === r.sysId);
      if (!record) return r;
      return r;
    });

    onComplete({
      total: records.length,
      successful: finalStatuses.filter((r) => r.status === 'success').length,
      failed: finalStatuses.filter((r) => r.status === 'error').length,
      errors: finalStatuses
        .filter((r) => r.status === 'error')
        .map((r) => ({ sysId: r.sysId, message: r.error || 'Unknown error' })),
    });
  };

  const handleStart = () => {
    if (isPaused) {
      setIsPaused(false);
    }
    processBatch();
  };

  const handlePause = () => {
    setIsPaused(true);
  };

  const handleCancel = () => {
    setIsCancelled(true);
    setIsPaused(false);
  };

  const isComplete = completed === records.length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50"
        onClick={!isRunning ? onClose : undefined}
      />

      {/* Modal */}
      <div className="relative bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <div className="flex items-center gap-3">
            <div className={clsx(
              'p-2 rounded-lg',
              operation === 'delete' ? 'bg-red-100' : 'bg-blue-100'
            )}>
              {operation === 'delete' ? (
                <Trash2 className={clsx('w-5 h-5', 'text-red-600')} />
              ) : (
                <Edit3 className="w-5 h-5 text-blue-600" />
              )}
            </div>
            <div>
              <h2 className="text-lg font-semibold text-gray-900">
                Batch {operation === 'delete' ? 'Delete' : 'Update'}
              </h2>
              <p className="text-sm text-gray-500">
                {records.length} record{records.length !== 1 ? 's' : ''} selected
              </p>
            </div>
          </div>
          {!isRunning && (
            <button
              onClick={onClose}
              className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
            >
              <X className="w-5 h-5 text-gray-500" />
            </button>
          )}
        </div>

        {/* Progress Bar */}
        <div className="px-6 py-4 bg-gray-50 border-b border-gray-200">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-4">
              <span className="text-sm font-medium text-gray-700">
                Progress: {completed} / {records.length}
              </span>
              {isRunning && !isPaused && (
                <span className="flex items-center gap-1.5 text-sm text-blue-600">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Processing...
                </span>
              )}
              {isPaused && (
                <span className="text-sm text-yellow-600">Paused</span>
              )}
              {isComplete && (
                <span className="text-sm text-green-600">Complete</span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-green-600">{successful} successful</span>
              {failed > 0 && (
                <span className="text-sm text-red-600">{failed} failed</span>
              )}
            </div>
          </div>
          <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
            <div
              className={clsx(
                'h-full transition-all duration-300',
                failed > 0 ? 'bg-gradient-to-r from-green-500 to-red-500' : 'bg-green-500'
              )}
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>

        {/* Record List */}
        <div className="flex-1 overflow-y-auto p-6">
          <div className="space-y-2">
            {recordStatuses.map((record) => (
              <div
                key={record.sysId}
                className={clsx(
                  'flex items-center justify-between p-3 rounded-lg',
                  record.status === 'pending' && 'bg-gray-50',
                  record.status === 'in_progress' && 'bg-blue-50 border border-blue-200',
                  record.status === 'success' && 'bg-green-50 border border-green-200',
                  record.status === 'error' && 'bg-red-50 border border-red-200'
                )}
              >
                <div className="flex items-center gap-3">
                  {record.status === 'pending' && (
                    <div className="w-5 h-5 rounded-full border-2 border-gray-300" />
                  )}
                  {record.status === 'in_progress' && (
                    <Loader2 className="w-5 h-5 text-blue-600 animate-spin" />
                  )}
                  {record.status === 'success' && (
                    <CheckCircle className="w-5 h-5 text-green-600" />
                  )}
                  {record.status === 'error' && (
                    <AlertCircle className="w-5 h-5 text-red-600" />
                  )}
                  <div>
                    <span className="text-sm font-medium text-gray-900">
                      {record.displayName}
                    </span>
                    {record.error && (
                      <p className="text-xs text-red-600 mt-0.5">{record.error}</p>
                    )}
                  </div>
                </div>
                <span className="text-xs text-gray-400 font-mono">
                  {record.sysId}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-gray-200 bg-gray-50">
          <div className="text-sm text-gray-500">
            {isComplete ? (
              <span className="flex items-center gap-2 text-green-600">
                <CheckCircle className="w-4 h-4" />
                Batch operation complete
              </span>
            ) : isCancelled ? (
              <span className="flex items-center gap-2 text-yellow-600">
                <XCircle className="w-4 h-4" />
                Operation cancelled
              </span>
            ) : null}
          </div>
          <div className="flex items-center gap-3">
            {!isComplete && !isCancelled && (
              <>
                {isRunning && !isPaused && (
                  <button
                    onClick={handlePause}
                    className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-yellow-700 bg-yellow-100 hover:bg-yellow-200 rounded-lg"
                  >
                    <Pause className="w-4 h-4" />
                    Pause
                  </button>
                )}
                {(isPaused || !isRunning) && currentIndex < records.length && (
                  <button
                    onClick={handleStart}
                    className={clsx(
                      'flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg',
                      operation === 'delete'
                        ? 'text-white bg-red-600 hover:bg-red-700'
                        : 'text-white bg-blue-600 hover:bg-blue-700'
                    )}
                  >
                    {isPaused ? (
                      <>
                        <RefreshCw className="w-4 h-4" />
                        Resume
                      </>
                    ) : (
                      <>
                        <Play className="w-4 h-4" />
                        Start
                      </>
                    )}
                  </button>
                )}
                {isRunning && (
                  <button
                    onClick={handleCancel}
                    className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg"
                  >
                    <XCircle className="w-4 h-4" />
                    Cancel
                  </button>
                )}
              </>
            )}
            {(isComplete || isCancelled) && (
              <button
                onClick={onClose}
                className="px-4 py-2 text-sm font-medium text-white bg-gray-600 hover:bg-gray-700 rounded-lg"
              >
                Close
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
