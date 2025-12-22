import { useState, useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import {
  X,
  Upload,
  FileText,
  Loader2,
  CheckCircle,
  AlertTriangle,
  AlertCircle,
  Brain,
  Save,
  Eye,
  EyeOff,
  Paperclip,
} from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { clsx } from 'clsx';
import { useSettingsStore } from '../../stores/settingsStore';
import { useRequestLogStore } from '../../stores/requestLogStore';
import { getServiceNowAPI, initServiceNowAPI } from '../../services/servicenow';
import { getOpenAIService } from '../../services/openai';
import { extractText } from '../../services/ocr';
import { TABLE_VIEW_CONFIG, type TableViewType, type Contract } from '../../types';
import { getSysId, getDisplayValue } from '../../utils/serviceNowHelpers';

interface UpdateFromDocumentModalProps {
  viewType: TableViewType;
  record: Record<string, unknown>;
  onClose: () => void;
  onSuccess: (updatedRecord: Record<string, unknown>) => void;
}

type ProcessingStatus =
  | 'idle'
  | 'extracting_text'
  | 'analyzing'
  | 'ready_for_review'
  | 'updating'
  | 'uploading_attachment'
  | 'complete'
  | 'error';

interface ExtractedField {
  key: string;
  label: string;
  currentValue: string;
  newValue: string;
  confidence: number;
  selected: boolean;
}

export function UpdateFromDocumentModal({
  viewType,
  record,
  onClose,
  onSuccess,
}: UpdateFromDocumentModalProps) {
  const { settings } = useSettingsStore();
  const { addEntry, updateEntry } = useRequestLogStore();
  const queryClient = useQueryClient();
  const config = TABLE_VIEW_CONFIG[viewType];

  const [status, setStatus] = useState<ProcessingStatus>('idle');
  const [progress, setProgress] = useState(0);
  const [progressText, setProgressText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [extractedFields, setExtractedFields] = useState<ExtractedField[]>([]);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [showCurrentValues, setShowCurrentValues] = useState(true);
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [shouldUploadAttachment, setShouldUploadAttachment] = useState(true);

  const recordSysId = getSysId(record.sys_id);

  // Field labels for display
  const fieldLabels: Record<string, string> = {
    short_description: 'Short Description',
    description: 'Description',
    starts: 'Start Date',
    ends: 'End Date',
    payment_amount: 'Payment Amount',
    payment_schedule: 'Payment Schedule',
    invoice_payment_terms: 'Payment Terms',
    u_payment_method: 'Payment Method',
    renewable: 'Renewable',
    contract_model: 'Contract Model',
    vendor_contract: 'Vendor Contract #',
    total_cost: 'Total Cost',
    monthly_cost: 'Monthly Cost',
    yearly_cost: 'Yearly Cost',
  };

  const processDocument = useCallback(async (file: File) => {
    setStatus('extracting_text');
    setProgress(10);
    setProgressText('Extracting text from document...');
    setError(null);

    try {
      // Step 1: Extract text via OCR
      const ocrResult = await extractText(file, (prog, statusText) => {
        setProgress(10 + prog * 0.3);
        setProgressText(statusText);
      });

      setStatus('analyzing');
      setProgress(50);
      setProgressText('Analyzing document with AI...');

      // Step 2: Use OpenAI to extract contract fields
      if (!settings.openai.apiKey) {
        throw new Error('OpenAI API key not configured. Please update settings.');
      }

      const openai = getOpenAIService(
        settings.openai.apiKey,
        settings.openai.model,
        settings.openai.temperature,
        settings.openai.maxTokens
      );

      const extraction = await openai.extractContractFieldsForUpdate(ocrResult.text);

      setProgress(80);
      setProgressText('Preparing field comparison...');

      // Step 3: Build the extracted fields list with comparison to current values
      const fields: ExtractedField[] = [];

      for (const [key, newValue] of Object.entries(extraction.fields)) {
        if (newValue !== null && newValue !== undefined && newValue !== '') {
          const currentValue = getDisplayValue(record[key]);
          fields.push({
            key,
            label: fieldLabels[key] || key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
            currentValue: currentValue || '',
            newValue: String(newValue),
            confidence: extraction.confidence[key] || 0,
            selected: true, // Default to selected
          });
        }
      }

      setExtractedFields(fields);
      setSuggestions(extraction.suggestions);
      setStatus('ready_for_review');
      setProgress(100);
      setProgressText('Ready for review');

      if (fields.length === 0) {
        setError('No contract fields could be extracted from the document. Please ensure the document contains contract information.');
      }
    } catch (err) {
      console.error('Document processing error:', err);
      setStatus('error');
      setError(err instanceof Error ? err.message : 'An error occurred while processing the document');
    }
  }, [record, settings.openai, fieldLabels]);

  const onDrop = useCallback(
    (acceptedFiles: File[]) => {
      const file = acceptedFiles[0];
      if (file) {
        setUploadedFile(file);
        processDocument(file);
      }
    },
    [processDocument]
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'application/pdf': ['.pdf'],
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
      'image/*': ['.png', '.jpg', '.jpeg', '.tiff', '.bmp'],
      'text/plain': ['.txt'],
    },
    multiple: false,
    disabled: status !== 'idle' && status !== 'error',
  });

  const toggleField = (key: string) => {
    setExtractedFields(prev =>
      prev.map(field =>
        field.key === key ? { ...field, selected: !field.selected } : field
      )
    );
  };

  const toggleAllFields = () => {
    const allSelected = extractedFields.every(f => f.selected);
    setExtractedFields(prev =>
      prev.map(field => ({ ...field, selected: !allSelected }))
    );
  };

  // Update mutation
  const updateMutation = useMutation({
    mutationFn: async () => {
      const api = (() => {
        try {
          return getServiceNowAPI(settings.servicenow.instanceUrl, settings.servicenow.apiKey);
        } catch {
          return initServiceNowAPI(settings.servicenow.instanceUrl, settings.servicenow.apiKey);
        }
      })();

      // Build update data from selected fields
      const updateData: Record<string, unknown> = {};
      for (const field of extractedFields) {
        if (field.selected) {
          updateData[field.key] = field.newValue;
        }
      }

      if (Object.keys(updateData).length === 0) {
        throw new Error('No fields selected for update');
      }

      // Log the request
      const startTime = Date.now();
      const logId = addEntry({
        method: 'PATCH',
        url: `${settings.servicenow.instanceUrl}/api/now/table/${config.table}/${recordSysId}`,
        table: config.table,
        recordSysId,
        headers: {
          'Content-Type': 'application/json',
          'x-sn-apikey': settings.servicenow.apiKey,
        },
        body: updateData,
      });

      try {
        const response = await api.update(config.table, recordSysId, updateData);
        const duration = Date.now() - startTime;

        updateEntry(logId, {
          responseStatus: 200,
          responseBody: response,
          duration,
        });

        // Upload attachment if enabled and file exists
        if (shouldUploadAttachment && uploadedFile && viewType === 'contracts') {
          setStatus('uploading_attachment');
          const attachmentLogId = addEntry({
            method: 'POST',
            url: `${settings.servicenow.instanceUrl}/api/now/attachment/upload`,
            table: config.table,
            recordSysId,
            headers: {
              'Content-Type': 'multipart/form-data',
              'x-sn-apikey': settings.servicenow.apiKey,
            },
            body: {
              table_name: config.table,
              table_sys_id: recordSysId,
              file_name: uploadedFile.name,
            },
          });

          try {
            const attachmentStartTime = Date.now();
            const attachmentResponse = await api.uploadAttachment(config.table, recordSysId, uploadedFile);
            const attachmentDuration = Date.now() - attachmentStartTime;

            updateEntry(attachmentLogId, {
              responseStatus: attachmentResponse.status,
              responseBody: attachmentResponse.data,
              duration: attachmentDuration,
            });
          } catch (err: unknown) {
            const attachmentDuration = Date.now() - startTime;
            const error = err as { message?: string };
            updateEntry(attachmentLogId, {
              responseStatus: 500,
              error: error.message,
              duration: attachmentDuration,
            });
            // Don't throw - attachment upload failure shouldn't fail the update
            console.error('Attachment upload failed:', err);
          }
        }

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
      setStatus('complete');
      setTimeout(() => {
        onSuccess(response.result || response);
      }, 1500);
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : 'Update failed');
      setStatus('error');
    },
  });

  const handleUpdate = () => {
    const selectedCount = extractedFields.filter(f => f.selected).length;
    if (selectedCount === 0) return;
    setStatus('updating');
    updateMutation.mutate();
  };

  const resetUpload = () => {
    setStatus('idle');
    setProgress(0);
    setProgressText('');
    setError(null);
    setExtractedFields([]);
    setSuggestions([]);
  };

  const getConfidenceColor = (confidence: number) => {
    if (confidence >= 80) return 'bg-green-100 text-green-700 border-green-200';
    if (confidence >= 50) return 'bg-yellow-100 text-yellow-700 border-yellow-200';
    return 'bg-red-100 text-red-700 border-red-200';
  };

  const selectedCount = extractedFields.filter(f => f.selected).length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />

      {/* Modal */}
      <div className="relative bg-white rounded-xl shadow-xl w-full max-w-3xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-purple-100 rounded-lg">
              <Brain className="w-5 h-5 text-purple-600" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-gray-900">
                Update from Document
              </h2>
              <p className="text-sm text-gray-500">
                Extract and apply contract data from uploaded document
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
          {/* Upload Zone */}
          {(status === 'idle' || status === 'error') && (
            <div
              {...getRootProps()}
              className={clsx(
                'border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors',
                isDragActive
                  ? 'border-purple-500 bg-purple-50'
                  : status === 'error'
                  ? 'border-red-300 bg-red-50'
                  : 'border-gray-300 hover:border-gray-400 bg-gray-50'
              )}
            >
              <input {...getInputProps()} />
              <Upload className="w-12 h-12 mx-auto text-gray-400 mb-4" />
              <p className="text-gray-600 font-medium">
                {isDragActive
                  ? 'Drop the document here...'
                  : 'Drag & drop a contract document, or click to select'}
              </p>
              <p className="text-sm text-gray-400 mt-2">
                Supports PDF, DOCX, and images (PNG, JPG)
              </p>
            </div>
          )}

          {/* Processing Status */}
          {(status === 'extracting_text' || status === 'analyzing') && (
            <div className="text-center py-8">
              <Loader2 className="w-12 h-12 mx-auto text-purple-500 animate-spin mb-4" />
              <p className="text-gray-600 font-medium">{progressText}</p>
              <div className="w-full bg-gray-200 rounded-full h-2 mt-4 max-w-md mx-auto">
                <div
                  className="bg-purple-500 h-2 rounded-full transition-all duration-300"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          )}

          {/* Error State */}
          {error && (
            <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-lg">
              <div className="flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-red-800">Error</p>
                  <p className="text-sm text-red-600 mt-1">{error}</p>
                  <button
                    onClick={resetUpload}
                    className="mt-2 text-sm text-red-700 hover:text-red-800 underline"
                  >
                    Try again
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Field Review */}
          {status === 'ready_for_review' && extractedFields.length > 0 && (
            <div className="space-y-4">
              {/* Suggestions */}
              {suggestions.length > 0 && (
                <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 text-yellow-600 flex-shrink-0 mt-0.5" />
                    <div className="text-sm text-yellow-700">
                      {suggestions.map((s, i) => (
                        <p key={i}>{s}</p>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* Attachment Upload Option */}
              {viewType === 'contracts' && uploadedFile && (
                <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Paperclip className="w-4 h-4 text-blue-600" />
                      <span className="text-sm text-blue-700 font-medium">
                        Upload PDF to ServiceNow after update
                      </span>
                    </div>
                    <input
                      type="checkbox"
                      checked={shouldUploadAttachment}
                      onChange={(e) => setShouldUploadAttachment(e.target.checked)}
                      className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                    />
                  </div>
                  <p className="text-xs text-blue-600 mt-1 ml-6">
                    {uploadedFile.name} ({(uploadedFile.size / (1024 * 1024)).toFixed(2)} MB)
                  </p>
                </div>
              )}

              {/* Controls */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <span className="text-sm font-medium text-gray-700">
                    {selectedCount} of {extractedFields.length} fields selected
                  </span>
                  <button
                    onClick={toggleAllFields}
                    className="text-sm text-purple-600 hover:text-purple-700"
                  >
                    {extractedFields.every(f => f.selected) ? 'Deselect All' : 'Select All'}
                  </button>
                </div>
                <button
                  onClick={() => setShowCurrentValues(!showCurrentValues)}
                  className="flex items-center gap-1 text-sm text-gray-600 hover:text-gray-800"
                >
                  {showCurrentValues ? (
                    <>
                      <EyeOff className="w-4 h-4" />
                      Hide current values
                    </>
                  ) : (
                    <>
                      <Eye className="w-4 h-4" />
                      Show current values
                    </>
                  )}
                </button>
              </div>

              {/* Fields List */}
              <div className="space-y-3">
                {extractedFields.map((field) => (
                  <div
                    key={field.key}
                    className={clsx(
                      'p-4 border rounded-lg transition-colors',
                      field.selected
                        ? 'border-purple-300 bg-purple-50'
                        : 'border-gray-200 bg-gray-50'
                    )}
                  >
                    <div className="flex items-start gap-3">
                      <input
                        type="checkbox"
                        checked={field.selected}
                        onChange={() => toggleField(field.key)}
                        className="mt-1 w-4 h-4 text-purple-600 border-gray-300 rounded focus:ring-purple-500"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between mb-2">
                          <label className="text-sm font-medium text-gray-700">
                            {field.label}
                          </label>
                          <span
                            className={clsx(
                              'px-2 py-0.5 text-xs font-medium rounded-full border',
                              getConfidenceColor(field.confidence)
                            )}
                          >
                            {field.confidence}% confidence
                          </span>
                        </div>

                        {showCurrentValues && field.currentValue && (
                          <div className="mb-2">
                            <span className="text-xs text-gray-500">Current: </span>
                            <span className="text-sm text-gray-600">
                              {field.currentValue || '(empty)'}
                            </span>
                          </div>
                        )}

                        <div className="flex items-center gap-2">
                          <span className="text-xs text-purple-600 font-medium">New: </span>
                          <input
                            type="text"
                            value={field.newValue}
                            onChange={(e) => {
                              setExtractedFields(prev =>
                                prev.map(f =>
                                  f.key === field.key ? { ...f, newValue: e.target.value } : f
                                )
                              );
                            }}
                            className="flex-1 px-2 py-1 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                          />
                        </div>

                        {field.currentValue && field.currentValue !== field.newValue && (
                          <div className="mt-1 text-xs text-orange-600">
                            Will update from "{field.currentValue}" to "{field.newValue}"
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Updating Status */}
          {(status === 'updating' || status === 'uploading_attachment') && (
            <div className="text-center py-8">
              <Loader2 className="w-12 h-12 mx-auto text-purple-500 animate-spin mb-4" />
              <p className="text-gray-600 font-medium">
                {status === 'updating' ? 'Updating contract...' : 'Uploading attachment to ServiceNow...'}
              </p>
            </div>
          )}

          {/* Success State */}
          {status === 'complete' && (
            <div className="text-center py-8">
              <CheckCircle className="w-12 h-12 mx-auto text-green-500 mb-4" />
              <p className="text-green-600 font-medium">Contract updated successfully!</p>
              <p className="text-sm text-gray-500 mt-2">
                {selectedCount} field{selectedCount !== 1 ? 's' : ''} updated
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-gray-200 bg-gray-50">
          <div className="text-sm text-gray-500">
            {status === 'ready_for_review' && (
              <span className="flex items-center gap-2">
                <FileText className="w-4 h-4" />
                Review extracted fields before updating
              </span>
            )}
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
            >
              {status === 'complete' ? 'Close' : 'Cancel'}
            </button>
            {status === 'ready_for_review' && (
              <button
                onClick={handleUpdate}
                disabled={selectedCount === 0 || updateMutation.isPending}
                className={clsx(
                  'flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg transition-colors',
                  selectedCount === 0 || updateMutation.isPending
                    ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                    : 'bg-purple-600 text-white hover:bg-purple-700'
                )}
              >
                <Save className="w-4 h-4" />
                Update Contract ({selectedCount} field{selectedCount !== 1 ? 's' : ''})
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
