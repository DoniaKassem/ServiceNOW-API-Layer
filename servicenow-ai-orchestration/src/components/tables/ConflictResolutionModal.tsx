import { useState } from 'react';
import {
  X,
  AlertTriangle,
  RefreshCw,
  GitMerge,
  ArrowLeft,
  ArrowRight,
  Check,
} from 'lucide-react';
import { clsx } from 'clsx';

interface ConflictResolutionModalProps {
  viewType: string;
  localData: Record<string, unknown>;
  serverData: Record<string, unknown>;
  onResolve: (resolution: 'local' | 'server' | 'merge', mergedData?: Record<string, unknown>) => void;
  onCancel: () => void;
}

interface FieldConflict {
  field: string;
  localValue: unknown;
  serverValue: unknown;
  resolution: 'local' | 'server';
}

export function ConflictResolutionModal({
  viewType: _viewType,
  localData,
  serverData,
  onResolve,
  onCancel,
}: ConflictResolutionModalProps) {
  // Find conflicting fields
  const [conflicts, setConflicts] = useState<FieldConflict[]>(() => {
    const result: FieldConflict[] = [];
    const ignoredFields = ['sys_id', 'sys_mod_count', 'sys_updated_on', 'sys_updated_by'];

    for (const field of Object.keys(localData)) {
      if (ignoredFields.includes(field)) continue;

      const localValue = localData[field];
      const serverValue = serverData[field];

      // Skip if values are the same
      if (JSON.stringify(localValue) === JSON.stringify(serverValue)) continue;

      // Only include if local data has actually changed
      result.push({
        field,
        localValue,
        serverValue,
        resolution: 'local', // Default to keeping local changes
      });
    }

    return result;
  });

  const formatFieldKey = (key: string): string => {
    return key
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase());
  };

  const formatValue = (value: unknown): string => {
    if (value === null || value === undefined) return '(empty)';
    if (typeof value === 'object') {
      const ref = value as { display_value?: string; value?: string };
      return ref.display_value || ref.value || JSON.stringify(value);
    }
    return String(value);
  };

  const toggleResolution = (field: string) => {
    setConflicts((prev) =>
      prev.map((c) =>
        c.field === field
          ? { ...c, resolution: c.resolution === 'local' ? 'server' : 'local' }
          : c
      )
    );
  };

  const handleResolveAll = (resolution: 'local' | 'server') => {
    if (resolution === 'local') {
      onResolve('local', localData);
    } else {
      onResolve('server');
    }
  };

  const handleMerge = () => {
    const mergedData: Record<string, unknown> = { ...serverData };

    for (const conflict of conflicts) {
      if (conflict.resolution === 'local') {
        mergedData[conflict.field] = conflict.localValue;
      }
    }

    // Include sys_mod_count from server for next update
    mergedData.sys_mod_count = serverData.sys_mod_count;

    onResolve('merge', mergedData);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50" onClick={onCancel} />

      {/* Modal */}
      <div className="relative bg-white rounded-xl shadow-xl w-full max-w-3xl max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 bg-yellow-50">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-yellow-100 rounded-lg">
              <AlertTriangle className="w-5 h-5 text-yellow-600" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Conflict Detected</h2>
              <p className="text-sm text-gray-600">
                This record has been modified by another user. Please resolve the conflicts.
              </p>
            </div>
          </div>
          <button
            onClick={onCancel}
            className="p-2 hover:bg-yellow-100 rounded-lg transition-colors"
          >
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        {/* Conflict Info */}
        <div className="px-6 py-3 bg-gray-50 border-b border-gray-200 text-sm">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <span className="text-gray-500">
                Last modified by: <span className="font-medium text-gray-700">{formatValue(serverData.sys_updated_by)}</span>
              </span>
              <span className="text-gray-500">
                at <span className="font-medium text-gray-700">{formatValue(serverData.sys_updated_on)}</span>
              </span>
            </div>
            <span className="text-gray-500">
              {conflicts.length} conflicting field{conflicts.length !== 1 ? 's' : ''}
            </span>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {conflicts.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              <Check className="w-12 h-12 mx-auto mb-3 text-green-500" />
              <p className="font-medium text-gray-700">No conflicting changes</p>
              <p className="text-sm">Your changes don't conflict with the server version.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {conflicts.map((conflict) => (
                <div
                  key={conflict.field}
                  className="border border-gray-200 rounded-lg overflow-hidden"
                >
                  <div className="px-4 py-2 bg-gray-50 border-b border-gray-200">
                    <span className="text-sm font-medium text-gray-700">
                      {formatFieldKey(conflict.field)}
                    </span>
                  </div>
                  <div className="flex">
                    {/* Server Value */}
                    <button
                      onClick={() => conflict.resolution !== 'server' && toggleResolution(conflict.field)}
                      className={clsx(
                        'flex-1 p-4 text-left transition-colors border-r border-gray-200',
                        conflict.resolution === 'server'
                          ? 'bg-green-50 border-green-200'
                          : 'bg-white hover:bg-gray-50'
                      )}
                    >
                      <div className="flex items-center gap-2 mb-2">
                        <ArrowLeft className="w-4 h-4 text-gray-400" />
                        <span className="text-xs font-medium text-gray-500 uppercase">Server Value</span>
                        {conflict.resolution === 'server' && (
                          <span className="ml-auto px-2 py-0.5 text-xs font-medium text-green-700 bg-green-100 rounded">
                            Selected
                          </span>
                        )}
                      </div>
                      <p className={clsx(
                        'text-sm break-words',
                        conflict.resolution === 'server' ? 'text-green-700 font-medium' : 'text-gray-700'
                      )}>
                        {formatValue(conflict.serverValue)}
                      </p>
                    </button>

                    {/* Local Value */}
                    <button
                      onClick={() => conflict.resolution !== 'local' && toggleResolution(conflict.field)}
                      className={clsx(
                        'flex-1 p-4 text-left transition-colors',
                        conflict.resolution === 'local'
                          ? 'bg-blue-50 border-blue-200'
                          : 'bg-white hover:bg-gray-50'
                      )}
                    >
                      <div className="flex items-center gap-2 mb-2">
                        <ArrowRight className="w-4 h-4 text-gray-400" />
                        <span className="text-xs font-medium text-gray-500 uppercase">Your Value</span>
                        {conflict.resolution === 'local' && (
                          <span className="ml-auto px-2 py-0.5 text-xs font-medium text-blue-700 bg-blue-100 rounded">
                            Selected
                          </span>
                        )}
                      </div>
                      <p className={clsx(
                        'text-sm break-words',
                        conflict.resolution === 'local' ? 'text-blue-700 font-medium' : 'text-gray-700'
                      )}>
                        {formatValue(conflict.localValue)}
                      </p>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-gray-200 bg-gray-50">
          <div className="flex items-center gap-2">
            <button
              onClick={() => handleResolveAll('server')}
              className="flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded-lg"
            >
              <RefreshCw className="w-4 h-4" />
              Discard My Changes
            </button>
            <button
              onClick={() => handleResolveAll('local')}
              className="flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded-lg"
            >
              <ArrowRight className="w-4 h-4" />
              Keep All My Changes
            </button>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={onCancel}
              className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleMerge}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
            >
              <GitMerge className="w-4 h-4" />
              Apply Selected Changes
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
