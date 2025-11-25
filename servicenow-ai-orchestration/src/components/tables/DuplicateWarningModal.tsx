import { X, AlertTriangle, CheckCircle } from 'lucide-react';
import { clsx } from 'clsx';
import type { TableViewType, DuplicateMatch } from '../../types';
import { getSysId, getRecordDisplayName } from '../../utils/serviceNowHelpers';

interface DuplicateWarningModalProps {
  viewType: TableViewType;
  matches: DuplicateMatch[];
  checkedFields: string[];
  onUseExisting: (match: DuplicateMatch) => void;
  onCreateAnyway: () => void;
  onCancel: () => void;
}

export function DuplicateWarningModal({
  viewType: _viewType,
  matches,
  checkedFields,
  onUseExisting,
  onCreateAnyway,
  onCancel,
}: DuplicateWarningModalProps) {
  // Format field name for display
  const formatField = (field: string): string => {
    return field
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase());
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-2xl w-[600px] max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-yellow-100 rounded-lg">
              <AlertTriangle className="w-5 h-5 text-yellow-600" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Potential Duplicates Found</h2>
              <p className="text-sm text-gray-500">
                Checked fields: {checkedFields.map(formatField).join(', ')}
              </p>
            </div>
          </div>
          <button
            onClick={onCancel}
            className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          <div className="space-y-3">
            {matches.map((match) => (
              <div
                key={match.sysId}
                className={clsx(
                  'p-4 border rounded-lg',
                  match.matchType === 'exact'
                    ? 'border-red-200 bg-red-50'
                    : 'border-yellow-200 bg-yellow-50'
                )}
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-gray-900">{match.displayValue}</span>
                      <span
                        className={clsx(
                          'px-2 py-0.5 text-xs font-medium rounded',
                          match.matchType === 'exact'
                            ? 'bg-red-100 text-red-700'
                            : 'bg-yellow-100 text-yellow-700'
                        )}
                      >
                        {match.matchType === 'exact' ? 'Exact Match' : 'Partial Match'}
                      </span>
                    </div>
                    <p className="text-sm text-gray-500 mt-1">
                      sys_id: <span className="font-mono">{match.sysId}</span>
                    </p>

                    {/* Matched fields */}
                    <div className="mt-2 flex flex-wrap gap-1">
                      {match.matchedFields.map((field) => (
                        <span
                          key={field}
                          className="px-2 py-0.5 text-xs bg-gray-100 text-gray-600 rounded"
                        >
                          {formatField(field)}:{' '}
                          {String(match.record[field] || '')}
                        </span>
                      ))}
                    </div>
                  </div>

                  <button
                    onClick={() => onUseExisting(match)}
                    className="flex items-center gap-1 px-3 py-1.5 text-sm text-blue-600 hover:bg-blue-50 rounded-lg"
                  >
                    <CheckCircle className="w-4 h-4" />
                    Use This
                  </button>
                </div>

                {/* Additional record details */}
                <div className="mt-3 pt-3 border-t border-gray-200">
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    {Object.entries(match.record)
                      .filter(([key]) => !['sys_id', ...match.matchedFields].includes(key))
                      .slice(0, 4)
                      .map(([key, value]) => (
                        <div key={key}>
                          <span className="text-gray-500">{formatField(key)}:</span>{' '}
                          <span className="text-gray-700">
                            {value ? String(value) : '-'}
                          </span>
                        </div>
                      ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between p-4 border-t border-gray-200 bg-gray-50">
          <p className="text-sm text-gray-500">
            {matches.length} potential {matches.length === 1 ? 'duplicate' : 'duplicates'} found
          </p>

          <div className="flex items-center gap-3">
            <button
              onClick={onCancel}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg"
            >
              Cancel
            </button>
            <button
              onClick={onCreateAnyway}
              className="px-4 py-2 text-sm font-medium text-white bg-yellow-600 hover:bg-yellow-700 rounded-lg"
            >
              Create Anyway
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Utility function to check for duplicates
export async function checkForDuplicates(
  api: any,
  table: string,
  data: Record<string, unknown>,
  fieldsToCheck: string[],
  excludeSysId?: string
): Promise<{ hasDuplicates: boolean; matches: DuplicateMatch[] }> {
  const matches: DuplicateMatch[] = [];

  for (const field of fieldsToCheck) {
    const value = data[field];
    if (!value || typeof value !== 'string' || value.length < 2) continue;

    try {
      // Check for exact matches
      let query = `${field}=${value}`;
      if (table === 'core_company') {
        query = `vendor=true^${query}`;
      }

      const exactResponse = await api.get(table, {
        sysparm_query: query,
        sysparm_limit: 5,
        sysparm_display_value: 'all',
      });

      for (const record of exactResponse.result || []) {
        const recordSysId = getSysId(record.sys_id);
        if (excludeSysId && recordSysId === excludeSysId) continue;
        if (matches.some((m) => m.sysId === recordSysId)) continue;

        matches.push({
          sysId: recordSysId,
          displayValue: getRecordDisplayName(record),
          matchType: 'exact',
          matchedFields: [field],
          record,
        });
      }

      // Check for partial matches (CONTAINS)
      query = `${field}LIKE${value}`;
      if (table === 'core_company') {
        query = `vendor=true^${query}`;
      }

      const partialResponse = await api.get(table, {
        sysparm_query: query,
        sysparm_limit: 5,
        sysparm_display_value: 'all',
      });

      for (const record of partialResponse.result || []) {
        const recordSysId = getSysId(record.sys_id);
        if (excludeSysId && recordSysId === excludeSysId) continue;

        const existingMatch = matches.find((m) => m.sysId === recordSysId);
        if (existingMatch) {
          // Update existing match with additional matched field
          if (!existingMatch.matchedFields.includes(field)) {
            existingMatch.matchedFields.push(field);
          }
        } else {
          matches.push({
            sysId: recordSysId,
            displayValue: getRecordDisplayName(record),
            matchType: 'partial',
            matchedFields: [field],
            record,
          });
        }
      }
    } catch (err) {
      console.error(`Error checking duplicates for field ${field}:`, err);
    }
  }

  return {
    hasDuplicates: matches.length > 0,
    matches: matches.slice(0, 10), // Limit to 10 matches
  };
}
