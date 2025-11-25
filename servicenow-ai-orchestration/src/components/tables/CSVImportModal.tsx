import { useState, useCallback, useMemo } from 'react';
import {
  X,
  Upload,
  FileSpreadsheet,
  Loader2,
  CheckCircle,
  AlertCircle,
  ArrowRight,
  Download,
  RefreshCw,
} from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { clsx } from 'clsx';
import { useSettingsStore } from '../../stores/settingsStore';
import { useRequestLogStore } from '../../stores/requestLogStore';
import { useTableViewStore } from '../../stores/tableViewStore';
import { getServiceNowAPI, initServiceNowAPI } from '../../services/servicenow';
import { TABLE_VIEW_CONFIG, type TableViewType, type ColumnConfig } from '../../types';

interface CSVImportModalProps {
  viewType: TableViewType;
  onClose: () => void;
  onSuccess: (count: number) => void;
}

interface CSVRow {
  [key: string]: string;
}

interface ImportProgress {
  total: number;
  completed: number;
  failed: number;
  errors: { row: number; message: string }[];
}

// Fields that shouldn't be imported
const EXCLUDED_FIELDS = [
  'sys_id',
  'sys_created_on',
  'sys_updated_on',
  'sys_created_by',
  'sys_updated_by',
  'sys_mod_count',
  'sys_tags',
];

export function CSVImportModal({
  viewType,
  onClose,
  onSuccess,
}: CSVImportModalProps) {
  const { settings } = useSettingsStore();
  const { addEntry, updateEntry } = useRequestLogStore();
  const { preferences } = useTableViewStore();
  const queryClient = useQueryClient();
  const config = TABLE_VIEW_CONFIG[viewType];
  const tableColumns = preferences[viewType]?.columns || [];

  // State
  const [step, setStep] = useState<'upload' | 'map' | 'preview' | 'import'>('upload');
  const [csvData, setCsvData] = useState<CSVRow[]>([]);
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [fieldMapping, setFieldMapping] = useState<Record<string, string>>({});
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [dragActive, setDragActive] = useState(false);

  // Available fields for mapping
  const availableFields = useMemo(() => {
    return tableColumns
      .filter((col: ColumnConfig) => !EXCLUDED_FIELDS.includes(col.field))
      .map((col: ColumnConfig) => ({
        field: col.field,
        label: col.label,
      }));
  }, [tableColumns]);

  // Parse CSV
  const parseCSV = useCallback((text: string): { headers: string[]; rows: CSVRow[] } => {
    const lines = text.trim().split('\n');
    if (lines.length < 2) {
      throw new Error('CSV must have at least a header row and one data row');
    }

    // Parse header
    const headers = parseCSVLine(lines[0]);

    // Parse data rows
    const rows: CSVRow[] = [];
    for (let i = 1; i < lines.length; i++) {
      const values = parseCSVLine(lines[i]);
      if (values.length === headers.length) {
        const row: CSVRow = {};
        headers.forEach((header, idx) => {
          row[header] = values[idx];
        });
        rows.push(row);
      }
    }

    return { headers, rows };
  }, []);

  // Parse a single CSV line (handling quotes)
  const parseCSVLine = (line: string): string[] => {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      const nextChar = line[i + 1];

      if (char === '"') {
        if (inQuotes && nextChar === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === ',' && !inQuotes) {
        result.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }

    result.push(current.trim());
    return result;
  };

  // Handle file upload
  const handleFileUpload = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const text = e.target?.result as string;
        const { headers, rows } = parseCSV(text);
        setCsvHeaders(headers);
        setCsvData(rows);

        // Auto-map fields with matching names
        const autoMapping: Record<string, string> = {};
        headers.forEach((header) => {
          const normalizedHeader = header.toLowerCase().replace(/[_\s-]/g, '');
          const matchingField = availableFields.find((f: { field: string; label: string }) => {
            const normalizedField = f.field.toLowerCase().replace(/[_\s-]/g, '');
            const normalizedLabel = f.label.toLowerCase().replace(/[_\s-]/g, '');
            return normalizedField === normalizedHeader || normalizedLabel === normalizedHeader;
          });
          if (matchingField) {
            autoMapping[header] = matchingField.field;
          }
        });
        setFieldMapping(autoMapping);

        setStep('map');
      } catch (err) {
        alert((err as Error).message || 'Failed to parse CSV file');
      }
    };
    reader.readAsText(file);
  }, [parseCSV, availableFields]);

  // Handle drag and drop
  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files?.[0]) {
      const file = e.dataTransfer.files[0];
      if (file.type === 'text/csv' || file.name.endsWith('.csv')) {
        handleFileUpload(file);
      } else {
        alert('Please upload a CSV file');
      }
    }
  }, [handleFileUpload]);

  const handleFileInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.[0]) {
      handleFileUpload(e.target.files[0]);
    }
  }, [handleFileUpload]);

  // Update field mapping
  const updateMapping = (csvHeader: string, snField: string) => {
    setFieldMapping((prev) => {
      const next = { ...prev };
      if (snField === '') {
        delete next[csvHeader];
      } else {
        next[csvHeader] = snField;
      }
      return next;
    });
  };

  // Get mapped data for preview
  const mappedData = useMemo(() => {
    return csvData.map((row) => {
      const mapped: Record<string, string> = {};
      for (const [csvHeader, snField] of Object.entries(fieldMapping)) {
        if (snField && row[csvHeader]) {
          mapped[snField] = row[csvHeader];
        }
      }
      return mapped;
    });
  }, [csvData, fieldMapping]);

  // Import mutation
  const importMutation = useMutation({
    mutationFn: async () => {
      const api = (() => {
        try {
          return getServiceNowAPI(settings.servicenow.instanceUrl, settings.servicenow.apiKey);
        } catch {
          return initServiceNowAPI(settings.servicenow.instanceUrl, settings.servicenow.apiKey);
        }
      })();

      const progressState: ImportProgress = {
        total: mappedData.length,
        completed: 0,
        failed: 0,
        errors: [],
      };
      setProgress(progressState);

      // Import records one by one (or in batches)
      for (let i = 0; i < mappedData.length; i++) {
        const recordData = mappedData[i];

        const startTime = Date.now();
        const logId = addEntry({
          method: 'POST',
          url: `${settings.servicenow.instanceUrl}/api/now/table/${config.table}`,
          table: config.table,
          headers: {
            'Content-Type': 'application/json',
            'x-sn-apikey': settings.servicenow.apiKey,
          },
          body: recordData,
        });

        try {
          const response = await api.create(config.table, recordData);
          const duration = Date.now() - startTime;

          updateEntry(logId, {
            responseStatus: 201,
            responseBody: response,
            duration,
          });

          progressState.completed++;
        } catch (err: unknown) {
          const duration = Date.now() - startTime;
          const error = err as { response?: { status?: number }; message?: string };

          updateEntry(logId, {
            responseStatus: error.response?.status || 500,
            error: error.message,
            duration,
          });

          progressState.failed++;
          progressState.errors.push({
            row: i + 1,
            message: error.message || 'Unknown error',
          });
        }

        setProgress({ ...progressState });
      }

      return progressState;
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['table', viewType] });
      if (result.completed > 0) {
        onSuccess(result.completed);
      }
    },
  });

  // Download template CSV
  const downloadTemplate = () => {
    const headers = availableFields.map((f: { field: string; label: string }) => f.field).join(',');
    const exampleRow = availableFields.map((f: { field: string; label: string }) => `"${f.label} value"`).join(',');
    const csv = `${headers}\n${exampleRow}`;

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${config.table}-template.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative bg-white rounded-xl shadow-xl w-full max-w-4xl max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-green-100 rounded-lg">
              <FileSpreadsheet className="w-5 h-5 text-green-600" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Import from CSV</h2>
              <p className="text-sm text-gray-500">
                Bulk import records into {config.label.toLowerCase()}
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

        {/* Steps Indicator */}
        <div className="flex items-center justify-center px-6 py-3 bg-gray-50 border-b border-gray-200">
          {['Upload', 'Map Fields', 'Preview', 'Import'].map((label, idx) => {
            const stepNames = ['upload', 'map', 'preview', 'import'] as const;
            const currentIdx = stepNames.indexOf(step);
            const isActive = idx === currentIdx;
            const isComplete = idx < currentIdx;

            return (
              <div key={label} className="flex items-center">
                {idx > 0 && (
                  <div className={clsx(
                    'w-8 h-0.5 mx-2',
                    isComplete ? 'bg-green-500' : 'bg-gray-300'
                  )} />
                )}
                <div className="flex items-center gap-2">
                  <div className={clsx(
                    'w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium',
                    isActive && 'bg-blue-600 text-white',
                    isComplete && 'bg-green-500 text-white',
                    !isActive && !isComplete && 'bg-gray-300 text-gray-600'
                  )}>
                    {isComplete ? <CheckCircle className="w-4 h-4" /> : idx + 1}
                  </div>
                  <span className={clsx(
                    'text-sm',
                    isActive && 'text-blue-600 font-medium',
                    !isActive && 'text-gray-500'
                  )}>
                    {label}
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {/* Upload Step */}
          {step === 'upload' && (
            <div className="space-y-6">
              {/* Drag & Drop Zone */}
              <div
                onDragEnter={handleDrag}
                onDragLeave={handleDrag}
                onDragOver={handleDrag}
                onDrop={handleDrop}
                className={clsx(
                  'border-2 border-dashed rounded-xl p-12 text-center transition-colors',
                  dragActive
                    ? 'border-blue-500 bg-blue-50'
                    : 'border-gray-300 hover:border-gray-400'
                )}
              >
                <Upload className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                <p className="text-lg font-medium text-gray-700 mb-2">
                  Drag and drop your CSV file here
                </p>
                <p className="text-sm text-gray-500 mb-4">or</p>
                <label className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 cursor-pointer transition-colors">
                  <Upload className="w-4 h-4" />
                  Browse Files
                  <input
                    type="file"
                    accept=".csv"
                    onChange={handleFileInputChange}
                    className="hidden"
                  />
                </label>
              </div>

              {/* Template Download */}
              <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                <div>
                  <p className="text-sm font-medium text-gray-700">Need a template?</p>
                  <p className="text-xs text-gray-500">
                    Download a CSV template with all available fields
                  </p>
                </div>
                <button
                  onClick={downloadTemplate}
                  className="flex items-center gap-2 px-3 py-2 text-sm text-blue-600 hover:bg-blue-50 rounded-lg"
                >
                  <Download className="w-4 h-4" />
                  Download Template
                </button>
              </div>
            </div>
          )}

          {/* Map Fields Step */}
          {step === 'map' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between mb-4">
                <p className="text-sm text-gray-600">
                  Map your CSV columns to ServiceNow fields ({Object.keys(fieldMapping).length} of {csvHeaders.length} mapped)
                </p>
                <button
                  onClick={() => {
                    // Reset mapping
                    setFieldMapping({});
                  }}
                  className="text-sm text-blue-600 hover:text-blue-700"
                >
                  Reset Mapping
                </button>
              </div>

              <div className="border border-gray-200 rounded-lg overflow-hidden">
                <table className="w-full">
                  <thead>
                    <tr className="bg-gray-50">
                      <th className="text-left px-4 py-3 text-sm font-medium text-gray-700">CSV Column</th>
                      <th className="w-12 text-center">
                        <ArrowRight className="w-4 h-4 text-gray-400 mx-auto" />
                      </th>
                      <th className="text-left px-4 py-3 text-sm font-medium text-gray-700">ServiceNow Field</th>
                      <th className="text-left px-4 py-3 text-sm font-medium text-gray-700">Sample Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {csvHeaders.map((header) => (
                      <tr key={header} className="border-t border-gray-200">
                        <td className="px-4 py-3 text-sm text-gray-900">{header}</td>
                        <td className="text-center">
                          <ArrowRight className="w-4 h-4 text-gray-400 mx-auto" />
                        </td>
                        <td className="px-4 py-3">
                          <select
                            value={fieldMapping[header] || ''}
                            onChange={(e) => updateMapping(header, e.target.value)}
                            className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                          >
                            <option value="">-- Skip this column --</option>
                            {availableFields.map((field) => (
                              <option
                                key={field.field}
                                value={field.field}
                                disabled={Object.values(fieldMapping).includes(field.field) && fieldMapping[header] !== field.field}
                              >
                                {field.label} ({field.field})
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-500 truncate max-w-[200px]">
                          {csvData[0]?.[header] || '-'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Preview Step */}
          {step === 'preview' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-sm text-gray-600">
                  Preview of {mappedData.length} records to import
                </p>
              </div>

              <div className="border border-gray-200 rounded-lg overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="bg-gray-50">
                      <th className="text-left px-4 py-3 text-sm font-medium text-gray-700 whitespace-nowrap">#</th>
                      {Object.values(fieldMapping).map((field) => (
                        <th key={field} className="text-left px-4 py-3 text-sm font-medium text-gray-700 whitespace-nowrap">
                          {availableFields.find((f: { field: string; label: string }) => f.field === field)?.label || field}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {mappedData.slice(0, 10).map((row, idx) => (
                      <tr key={idx} className="border-t border-gray-200">
                        <td className="px-4 py-2 text-sm text-gray-500">{idx + 1}</td>
                        {Object.values(fieldMapping).map((field) => (
                          <td key={field} className="px-4 py-2 text-sm text-gray-900 whitespace-nowrap truncate max-w-[200px]">
                            {row[field] || '-'}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {mappedData.length > 10 && (
                  <div className="px-4 py-2 bg-gray-50 text-sm text-gray-500 text-center border-t border-gray-200">
                    ... and {mappedData.length - 10} more rows
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Import Step */}
          {step === 'import' && (
            <div className="space-y-6">
              {progress && (
                <>
                  {/* Progress Bar */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-gray-600">
                        Importing records...
                      </span>
                      <span className="text-gray-900 font-medium">
                        {progress.completed + progress.failed} / {progress.total}
                      </span>
                    </div>
                    <div className="h-3 bg-gray-200 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-blue-500 to-blue-600 transition-all duration-300"
                        style={{ width: `${((progress.completed + progress.failed) / progress.total) * 100}%` }}
                      />
                    </div>
                  </div>

                  {/* Stats */}
                  <div className="grid grid-cols-3 gap-4">
                    <div className="p-4 bg-blue-50 rounded-lg text-center">
                      <p className="text-2xl font-bold text-blue-600">{progress.total}</p>
                      <p className="text-sm text-blue-600">Total</p>
                    </div>
                    <div className="p-4 bg-green-50 rounded-lg text-center">
                      <p className="text-2xl font-bold text-green-600">{progress.completed}</p>
                      <p className="text-sm text-green-600">Imported</p>
                    </div>
                    <div className="p-4 bg-red-50 rounded-lg text-center">
                      <p className="text-2xl font-bold text-red-600">{progress.failed}</p>
                      <p className="text-sm text-red-600">Failed</p>
                    </div>
                  </div>

                  {/* Errors */}
                  {progress.errors.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-sm font-medium text-red-600">Errors:</p>
                      <div className="max-h-40 overflow-y-auto space-y-1">
                        {progress.errors.map((error, idx) => (
                          <div key={idx} className="flex items-start gap-2 p-2 bg-red-50 rounded text-sm">
                            <AlertCircle className="w-4 h-4 text-red-500 mt-0.5 flex-shrink-0" />
                            <span className="text-red-700">
                              Row {error.row}: {error.message}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Completion */}
                  {progress.completed + progress.failed === progress.total && (
                    <div className="flex items-center justify-center gap-3 p-4 bg-green-50 rounded-lg">
                      <CheckCircle className="w-6 h-6 text-green-600" />
                      <span className="text-green-700 font-medium">
                        Import complete! {progress.completed} records created.
                      </span>
                    </div>
                  )}
                </>
              )}

              {importMutation.isPending && !progress && (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-gray-200 bg-gray-50">
          <div>
            {step !== 'upload' && step !== 'import' && (
              <button
                onClick={() => {
                  if (step === 'preview') {
                    setStep('map');
                  } else if (step === 'map') {
                    setStep('upload');
                  }
                }}
                className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
              >
                Back
              </button>
            )}
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
            >
              {step === 'import' && progress?.completed ? 'Close' : 'Cancel'}
            </button>

            {step === 'map' && (
              <button
                onClick={() => setStep('preview')}
                disabled={Object.keys(fieldMapping).length === 0}
                className={clsx(
                  'flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg transition-colors',
                  Object.keys(fieldMapping).length === 0
                    ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                    : 'bg-blue-600 text-white hover:bg-blue-700'
                )}
              >
                Preview
                <ArrowRight className="w-4 h-4" />
              </button>
            )}

            {step === 'preview' && (
              <button
                onClick={() => {
                  setStep('import');
                  importMutation.mutate();
                }}
                disabled={mappedData.length === 0}
                className={clsx(
                  'flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg transition-colors',
                  mappedData.length === 0
                    ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                    : 'bg-green-600 text-white hover:bg-green-700'
                )}
              >
                <RefreshCw className="w-4 h-4" />
                Import {mappedData.length} Records
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
