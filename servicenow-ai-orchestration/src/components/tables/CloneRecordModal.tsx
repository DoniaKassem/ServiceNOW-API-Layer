import { useState, useMemo } from 'react';
import {
  X,
  Copy,
  Loader2,
  CheckCircle,
  AlertCircle,
} from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { clsx } from 'clsx';
import { useSettingsStore } from '../../stores/settingsStore';
import { useRequestLogStore } from '../../stores/requestLogStore';
import { getServiceNowAPI, initServiceNowAPI } from '../../services/servicenow';
import { TABLE_VIEW_CONFIG, type TableViewType } from '../../types';

interface CloneRecordModalProps {
  viewType: TableViewType;
  record: Record<string, unknown>;
  onClose: () => void;
  onSuccess: (newRecord: Record<string, unknown>) => void;
}

// Fields to exclude when cloning
const SYSTEM_FIELDS = [
  'sys_id',
  'sys_created_on',
  'sys_updated_on',
  'sys_created_by',
  'sys_updated_by',
  'sys_mod_count',
  'sys_tags',
];

export function CloneRecordModal({
  viewType,
  record,
  onClose,
  onSuccess,
}: CloneRecordModalProps) {
  const { settings } = useSettingsStore();
  const { addEntry, updateEntry } = useRequestLogStore();
  const queryClient = useQueryClient();
  const config = TABLE_VIEW_CONFIG[viewType];

  // Track which fields to include in clone
  const [selectedFields, setSelectedFields] = useState<Set<string>>(() => {
    const cloneableFields = Object.keys(record).filter(
      (key) => !SYSTEM_FIELDS.includes(key)
    );
    return new Set(cloneableFields);
  });

  // Track field overrides
  const [fieldOverrides, setFieldOverrides] = useState<Record<string, string>>({});

  // Get cloneable fields
  const cloneableFields = useMemo(() => {
    return Object.entries(record)
      .filter(([key]) => !SYSTEM_FIELDS.includes(key))
      .map(([key, value]) => ({
        key,
        value,
        displayValue: getDisplayValue(value),
      }));
  }, [record]);

  function getDisplayValue(value: unknown): string {
    if (value === null || value === undefined) return '';
    if (typeof value === 'object') {
      const ref = value as { display_value?: string; value?: string };
      return ref.display_value || ref.value || JSON.stringify(value);
    }
    return String(value);
  }

  const toggleField = (field: string) => {
    setSelectedFields((prev) => {
      const next = new Set(prev);
      if (next.has(field)) {
        next.delete(field);
      } else {
        next.add(field);
      }
      return next;
    });
  };

  const toggleAll = () => {
    if (selectedFields.size === cloneableFields.length) {
      setSelectedFields(new Set());
    } else {
      setSelectedFields(new Set(cloneableFields.map((f) => f.key)));
    }
  };

  const updateOverride = (field: string, value: string) => {
    setFieldOverrides((prev) => ({ ...prev, [field]: value }));
  };

  // Clone mutation
  const cloneMutation = useMutation({
    mutationFn: async () => {
      const api = (() => {
        try {
          return getServiceNowAPI(settings.servicenow.instanceUrl, settings.servicenow.apiKey);
        } catch {
          return initServiceNowAPI(settings.servicenow.instanceUrl, settings.servicenow.apiKey);
        }
      })();

      // Build clone data
      const cloneData: Record<string, unknown> = {};
      for (const field of selectedFields) {
        const originalValue = record[field];
        const override = fieldOverrides[field];

        if (override !== undefined && override !== '') {
          cloneData[field] = override;
        } else if (typeof originalValue === 'object' && originalValue !== null) {
          // For reference fields, use the value (sys_id)
          const ref = originalValue as { value?: string };
          cloneData[field] = ref.value || originalValue;
        } else {
          cloneData[field] = originalValue;
        }
      }

      // Log the request
      const startTime = Date.now();
      const logId = addEntry({
        method: 'POST',
        url: `${settings.servicenow.instanceUrl}/api/now/table/${config.table}`,
        table: config.table,
        headers: {
          'Content-Type': 'application/json',
          'x-sn-apikey': settings.servicenow.apiKey,
        },
        body: cloneData,
      });

      try {
        const response = await api.create(config.table, cloneData);
        const duration = Date.now() - startTime;

        updateEntry(logId, {
          responseStatus: 201,
          responseBody: response,
          duration,
        });

        return response;
      } catch (err: unknown) {
        const duration = Date.now() - startTime;
        const error = err as { response?: { status?: number }; message?: string };
        updateEntry(logId, {
          responseStatus: error.response?.status || 500,
          error: error.message,
          duration,
        });
        throw err;
      }
    },
    onSuccess: (response) => {
      queryClient.invalidateQueries({ queryKey: ['table', viewType] });
      onSuccess(response.result || response);
    },
  });

  const handleClone = () => {
    if (selectedFields.size === 0) return;
    cloneMutation.mutate();
  };

  const formatFieldKey = (key: string): string => {
    return key
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase());
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-100 rounded-lg">
              <Copy className="w-5 h-5 text-blue-600" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Clone Record</h2>
              <p className="text-sm text-gray-500">
                Create a copy of this {config.label.toLowerCase().slice(0, -1)}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {/* Select All */}
          <div className="flex items-center justify-between mb-4">
            <span className="text-sm font-medium text-gray-700">
              Select fields to clone ({selectedFields.size} of {cloneableFields.length})
            </span>
            <button
              onClick={toggleAll}
              className="text-sm text-blue-600 hover:text-blue-700"
            >
              {selectedFields.size === cloneableFields.length ? 'Deselect All' : 'Select All'}
            </button>
          </div>

          {/* Fields List */}
          <div className="space-y-2">
            {cloneableFields.map(({ key, displayValue }) => (
              <div
                key={key}
                className={clsx(
                  'p-3 border rounded-lg transition-colors',
                  selectedFields.has(key)
                    ? 'border-blue-300 bg-blue-50'
                    : 'border-gray-200 bg-gray-50'
                )}
              >
                <div className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    checked={selectedFields.has(key)}
                    onChange={() => toggleField(key)}
                    className="mt-1 w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                  />
                  <div className="flex-1 min-w-0">
                    <label className="text-sm font-medium text-gray-700 cursor-pointer">
                      {formatFieldKey(key)}
                    </label>
                    <div className="mt-1">
                      {selectedFields.has(key) ? (
                        <input
                          type="text"
                          value={fieldOverrides[key] ?? displayValue}
                          onChange={(e) => updateOverride(key, e.target.value)}
                          placeholder={displayValue || '(empty)'}
                          className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        />
                      ) : (
                        <span className="text-sm text-gray-500 truncate block">
                          {displayValue || '(empty)'}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {cloneableFields.length === 0 && (
            <div className="text-center py-8 text-gray-500">
              No cloneable fields found
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-gray-200 bg-gray-50">
          <div className="text-sm text-gray-500">
            {cloneMutation.isSuccess && (
              <span className="flex items-center gap-2 text-green-600">
                <CheckCircle className="w-4 h-4" />
                Record cloned successfully!
              </span>
            )}
            {cloneMutation.isError && (
              <span className="flex items-center gap-2 text-red-600">
                <AlertCircle className="w-4 h-4" />
                {(cloneMutation.error as Error)?.message || 'Clone failed'}
              </span>
            )}
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleClone}
              disabled={selectedFields.size === 0 || cloneMutation.isPending}
              className={clsx(
                'flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg transition-colors',
                selectedFields.size === 0 || cloneMutation.isPending
                  ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                  : 'bg-blue-600 text-white hover:bg-blue-700'
              )}
            >
              {cloneMutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Cloning...
                </>
              ) : (
                <>
                  <Copy className="w-4 h-4" />
                  Clone Record
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
