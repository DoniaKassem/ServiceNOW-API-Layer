import { useState, useCallback } from 'react';
import { X, Save, Loader2, AlertTriangle } from 'lucide-react';
import { useMutation } from '@tanstack/react-query';
import { useSettingsStore } from '../../stores/settingsStore';
import { useRequestLogStore } from '../../stores/requestLogStore';
import { getServiceNowAPI, initServiceNowAPI } from '../../services/servicenow';
import { TABLE_VIEW_CONFIG, type TableViewType } from '../../types';

interface BulkEditModalProps {
  viewType: TableViewType;
  sysIds: string[];
  onClose: () => void;
  onSuccess: () => void;
}

// Fields that can be bulk edited for each table type
const BULK_EDIT_FIELDS: Record<TableViewType, {
  field: string;
  label: string;
  type: 'text' | 'select';
  options?: { value: string; label: string }[];
}[]> = {
  vendors: [
    { field: 'vendor_type', label: 'Vendor Type', type: 'select', options: [
      { value: 'advisory', label: 'Advisory' },
      { value: 'contractor', label: 'Contractor' },
      { value: 'manufacturer', label: 'Manufacturer' },
      { value: 'reseller', label: 'Reseller' },
      { value: 'software', label: 'Software' },
    ]},
    { field: 'vendor_manager', label: 'Vendor Manager', type: 'text' },
    { field: 'city', label: 'City', type: 'text' },
    { field: 'state', label: 'State', type: 'text' },
    { field: 'country', label: 'Country', type: 'text' },
  ],
  suppliers: [
    { field: 'city', label: 'City', type: 'text' },
    { field: 'state', label: 'State', type: 'text' },
    { field: 'country', label: 'Country', type: 'text' },
  ],
  contracts: [
    { field: 'state', label: 'State', type: 'select', options: [
      { value: 'draft', label: 'Draft' },
      { value: 'active', label: 'Active' },
      { value: 'expired', label: 'Expired' },
      { value: 'cancelled', label: 'Cancelled' },
    ]},
    { field: 'contract_administrator', label: 'Contract Administrator', type: 'text' },
    { field: 'approver', label: 'Approver', type: 'text' },
    { field: 'payment_schedule', label: 'Payment Schedule', type: 'select', options: [
      { value: 'annually', label: 'Annually' },
      { value: 'monthly', label: 'Monthly' },
      { value: 'quarterly', label: 'Quarterly' },
      { value: 'one_time', label: 'One Time' },
    ]},
  ],
  purchase_orders: [
    { field: 'status', label: 'Status', type: 'select', options: [
      { value: 'draft', label: 'Draft' },
      { value: 'pending_approval', label: 'Pending Approval' },
      { value: 'approved', label: 'Approved' },
      { value: 'ordered', label: 'Ordered' },
      { value: 'received', label: 'Received' },
      { value: 'cancelled', label: 'Cancelled' },
    ]},
  ],
};

export function BulkEditModal({
  viewType,
  sysIds,
  onClose,
  onSuccess,
}: BulkEditModalProps) {
  const { settings } = useSettingsStore();
  const { addEntry, updateEntry } = useRequestLogStore();
  const config = TABLE_VIEW_CONFIG[viewType];
  const editableFields = BULK_EDIT_FIELDS[viewType];

  const [formData, setFormData] = useState<Record<string, string>>({});
  const [progress, setProgress] = useState({ current: 0, total: sysIds.length });
  const [results, setResults] = useState<{ sysId: string; success: boolean; error?: string }[]>([]);

  // Get API instance
  const getApi = useCallback(() => {
    if (!settings.servicenow.apiKey || !settings.servicenow.instanceUrl) {
      throw new Error('API not configured');
    }
    try {
      return getServiceNowAPI(settings.servicenow.instanceUrl, settings.servicenow.apiKey);
    } catch {
      return initServiceNowAPI(settings.servicenow.instanceUrl, settings.servicenow.apiKey);
    }
  }, [settings.servicenow]);

  // Bulk update mutation
  const bulkUpdateMutation = useMutation({
    mutationFn: async () => {
      const api = getApi();
      const updateResults: { sysId: string; success: boolean; error?: string }[] = [];

      // Only include non-empty fields
      const updateData: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(formData)) {
        if (value !== '') {
          updateData[key] = value;
        }
      }

      if (Object.keys(updateData).length === 0) {
        throw new Error('No fields selected for update');
      }

      // Process each record sequentially
      for (let i = 0; i < sysIds.length; i++) {
        const sysId = sysIds[i];
        setProgress({ current: i + 1, total: sysIds.length });

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
          body: updateData,
        });

        try {
          await api.update(config.table, sysId, updateData);
          const duration = Date.now() - startTime;
          updateEntry(logId, { responseStatus: 200, duration });
          updateResults.push({ sysId, success: true });
        } catch (err: any) {
          const duration = Date.now() - startTime;
          updateEntry(logId, {
            responseStatus: err.response?.status || 500,
            error: err.message,
            duration,
          });
          updateResults.push({ sysId, success: false, error: err.message });
        }

        setResults([...updateResults]);
      }

      return updateResults;
    },
    onSuccess: (results) => {
      const allSuccess = results.every((r) => r.success);
      if (allSuccess) {
        onSuccess();
      }
    },
  });

  const handleFieldChange = useCallback((field: string, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  }, []);

  const handleSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    bulkUpdateMutation.mutate();
  }, [bulkUpdateMutation]);

  const hasAnyValue = Object.values(formData).some((v) => v !== '');
  const successCount = results.filter((r) => r.success).length;
  const failureCount = results.filter((r) => !r.success).length;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-2xl w-[600px] max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Bulk Edit</h2>
            <p className="text-sm text-gray-500">
              Editing {sysIds.length} {config.label.toLowerCase()}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {bulkUpdateMutation.isPending ? (
            <div className="space-y-4">
              <div className="text-center">
                <Loader2 className="w-8 h-8 text-blue-500 animate-spin mx-auto mb-2" />
                <p className="text-sm text-gray-600">
                  Updating record {progress.current} of {progress.total}...
                </p>
              </div>

              {/* Progress bar */}
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div
                  className="bg-blue-600 h-2 rounded-full transition-all"
                  style={{ width: `${(progress.current / progress.total) * 100}%` }}
                />
              </div>

              {/* Results summary */}
              {results.length > 0 && (
                <div className="flex items-center justify-center gap-4 text-sm">
                  <span className="text-green-600">{successCount} successful</span>
                  {failureCount > 0 && (
                    <span className="text-red-600">{failureCount} failed</span>
                  )}
                </div>
              )}
            </div>
          ) : results.length > 0 ? (
            <div className="space-y-4">
              {/* Results summary */}
              <div className="p-4 bg-gray-50 rounded-lg">
                <h3 className="font-medium text-gray-900 mb-2">Update Complete</h3>
                <div className="flex items-center gap-4 text-sm">
                  <span className="text-green-600">{successCount} successful</span>
                  {failureCount > 0 && (
                    <span className="text-red-600">{failureCount} failed</span>
                  )}
                </div>
              </div>

              {/* Failed records */}
              {failureCount > 0 && (
                <div className="space-y-2">
                  <h4 className="font-medium text-gray-700 text-sm">Failed Records:</h4>
                  {results
                    .filter((r) => !r.success)
                    .map((result) => (
                      <div
                        key={result.sysId}
                        className="p-2 bg-red-50 border border-red-200 rounded text-sm"
                      >
                        <span className="font-mono text-red-700">{result.sysId}</span>
                        <span className="text-red-600 ml-2">- {result.error}</span>
                      </div>
                    ))}
                </div>
              )}
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="flex items-start gap-2 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                <AlertTriangle className="w-5 h-5 text-yellow-500 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm text-yellow-700">
                    Only fill in fields you want to change. Empty fields will be ignored.
                  </p>
                </div>
              </div>

              {editableFields.map((fieldConfig) => (
                <div key={fieldConfig.field}>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {fieldConfig.label}
                  </label>
                  {fieldConfig.type === 'text' ? (
                    <input
                      type="text"
                      value={formData[fieldConfig.field] || ''}
                      onChange={(e) => handleFieldChange(fieldConfig.field, e.target.value)}
                      placeholder="Leave empty to skip"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    />
                  ) : (
                    <select
                      value={formData[fieldConfig.field] || ''}
                      onChange={(e) => handleFieldChange(fieldConfig.field, e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    >
                      <option value="">No change</option>
                      {fieldConfig.options?.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              ))}
            </form>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 p-4 border-t border-gray-200 bg-gray-50">
          {results.length > 0 ? (
            <button
              onClick={failureCount > 0 ? onClose : onSuccess}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg"
            >
              {failureCount > 0 ? 'Close' : 'Done'}
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg"
              >
                Cancel
              </button>
              <button
                onClick={handleSubmit}
                disabled={!hasAnyValue || bulkUpdateMutation.isPending}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-50"
              >
                <Save className="w-4 h-4" />
                Update {sysIds.length} Records
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
