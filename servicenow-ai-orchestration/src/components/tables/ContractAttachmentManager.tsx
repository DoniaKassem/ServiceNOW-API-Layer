import { useState, useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  X,
  Upload,
  Paperclip,
  Loader2,
  CheckCircle,
  AlertTriangle,
  AlertCircle,
  FileText,
  Download,
  Trash2,
  Eye,
} from 'lucide-react';
import { clsx } from 'clsx';
import { useSettingsStore } from '../../stores/settingsStore';
import { useRequestLogStore } from '../../stores/requestLogStore';
import { getServiceNowAPI, initServiceNowAPI } from '../../services/servicenow';
import { getSysId, getDisplayValue } from '../../utils/serviceNowHelpers';
import type { Attachment } from '../../types';

interface ContractAttachmentManagerProps {
  contractSysId: string;
  contractNumber: string;
  onClose: () => void;
  onSuccess?: () => void;
}

type UploadStatus = 'idle' | 'validating' | 'uploading' | 'success' | 'error';

interface ValidationError {
  field: string;
  message: string;
}

export function ContractAttachmentManager({
  contractSysId,
  contractNumber,
  onClose,
  onSuccess,
}: ContractAttachmentManagerProps) {
  const { settings } = useSettingsStore();
  const { addEntry, updateEntry } = useRequestLogStore();
  const queryClient = useQueryClient();

  const [uploadStatus, setUploadStatus] = useState<UploadStatus>('idle');
  const [uploadProgress, setUploadProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [validationErrors, setValidationErrors] = useState<ValidationError[]>([]);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  // Fetch contract data for validation
  const { data: contractData, isLoading: isLoadingContract } = useQuery({
    queryKey: ['contract', contractSysId],
    queryFn: async () => {
      const api = (() => {
        try {
          return getServiceNowAPI(settings.servicenow.instanceUrl, settings.servicenow.apiKey);
        } catch {
          return initServiceNowAPI(settings.servicenow.instanceUrl, settings.servicenow.apiKey);
        }
      })();
      
      const response = await api.getContractById(contractSysId);
      return response.result;
    },
  });

  // Fetch existing attachments
  const { data: attachments, isLoading: isLoadingAttachments, refetch: refetchAttachments } = useQuery({
    queryKey: ['attachments', contractSysId],
    queryFn: async () => {
      const api = (() => {
        try {
          return getServiceNowAPI(settings.servicenow.instanceUrl, settings.servicenow.apiKey);
        } catch {
          return initServiceNowAPI(settings.servicenow.instanceUrl, settings.servicenow.apiKey);
        }
      })();
      
      const response = await api.getAttachments('ast_contract', contractSysId);
      return response.result;
    },
  });

  // Validate contract fields
  const validateContract = useCallback((): ValidationError[] => {
    const errors: ValidationError[] = [];

    if (!contractData) {
      errors.push({ field: 'general', message: 'Contract data not loaded' });
      return errors;
    }

    // Required field validation
    const requiredFields: { key: keyof typeof contractData; label: string }[] = [
      { key: 'short_description', label: 'Short Description' },
      { key: 'vendor', label: 'Vendor' },
      { key: 'starts', label: 'Start Date' },
      { key: 'ends', label: 'End Date' },
    ];

    for (const { key, label } of requiredFields) {
      const value = getDisplayValue(contractData[key]);
      if (!value || value.trim() === '') {
        errors.push({ field: key, message: `${label} is required` });
      }
    }

    // Date validation
    const startsStr = getDisplayValue(contractData.starts);
    const endsStr = getDisplayValue(contractData.ends);
    if (startsStr && endsStr) {
      const starts = new Date(startsStr);
      const ends = new Date(endsStr);
      if (starts >= ends) {
        errors.push({ field: 'ends', message: 'End date must be after start date' });
      }
    }

    // Payment validation
    const paymentAmount = getDisplayValue(contractData.payment_amount);
    if (paymentAmount && parseFloat(paymentAmount) <= 0) {
      errors.push({ field: 'payment_amount', message: 'Payment amount must be greater than zero' });
    }

    return errors;
  }, [contractData]);

  // Upload mutation
  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      setUploadStatus('validating');
      setUploadProgress(10);
      setError(null);
      setValidationErrors([]);

      // Step 1: Validate contract fields
      const errors = validateContract();
      if (errors.length > 0) {
        setValidationErrors(errors);
        throw new Error('Contract validation failed. Please fix the errors before uploading.');
      }

      setUploadProgress(30);
      setUploadStatus('uploading');

      // Step 2: Upload PDF to ServiceNow
      const api = (() => {
        try {
          return getServiceNowAPI(settings.servicenow.instanceUrl, settings.servicenow.apiKey);
        } catch {
          return initServiceNowAPI(settings.servicenow.instanceUrl, settings.servicenow.apiKey);
        }
      })();

      const startTime = Date.now();
      const logId = addEntry({
        method: 'POST',
        url: `${settings.servicenow.instanceUrl}/api/now/attachment/upload`,
        table: 'ast_contract',
        recordSysId: contractSysId,
        headers: {
          'Content-Type': 'multipart/form-data',
          'x-sn-apikey': settings.servicenow.apiKey,
        },
        body: {
          table_name: 'ast_contract',
          table_sys_id: contractSysId,
          file_name: file.name,
        },
      });

      try {
        setUploadProgress(60);
        const response = await api.uploadAttachment('ast_contract', contractSysId, file);
        const duration = Date.now() - startTime;

        if (response.status === 201 || response.status === 200) {
          updateEntry(logId, {
            responseStatus: response.status,
            responseBody: response.data,
            duration,
          });

          setUploadProgress(100);
          return response.data;
        } else {
          throw new Error(response.error || 'Upload failed');
        }
      } catch (err: unknown) {
        const duration = Date.now() - startTime;
        const error = err as { message?: string };
        updateEntry(logId, {
          responseStatus: 500,
          error: error.message,
          duration,
        });
        throw err;
      }
    },
    onSuccess: () => {
      setUploadStatus('success');
      refetchAttachments();
      queryClient.invalidateQueries({ queryKey: ['attachments', contractSysId] });
      setTimeout(() => {
        if (onSuccess) onSuccess();
        setUploadStatus('idle');
        setSelectedFile(null);
        setUploadProgress(0);
      }, 2000);
    },
    onError: (err) => {
      setUploadStatus('error');
      setError(err instanceof Error ? err.message : 'Upload failed');
    },
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: async (attachmentSysId: string) => {
      const api = (() => {
        try {
          return getServiceNowAPI(settings.servicenow.instanceUrl, settings.servicenow.apiKey);
        } catch {
          return initServiceNowAPI(settings.servicenow.instanceUrl, settings.servicenow.apiKey);
        }
      })();

      await api.deleteAttachment(attachmentSysId);
    },
    onSuccess: () => {
      refetchAttachments();
      queryClient.invalidateQueries({ queryKey: ['attachments', contractSysId] });
    },
  });

  const onDrop = useCallback(
    (acceptedFiles: File[]) => {
      const file = acceptedFiles[0];
      if (file) {
        // Validate file type
        if (file.type !== 'application/pdf') {
          setError('Only PDF files are allowed');
          return;
        }

        // Validate file size (max 10MB)
        if (file.size > 10 * 1024 * 1024) {
          setError('File size must be less than 10MB');
          return;
        }

        setSelectedFile(file);
        setError(null);
      }
    },
    []
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'application/pdf': ['.pdf'],
    },
    multiple: false,
    disabled: uploadStatus === 'uploading' || uploadStatus === 'validating',
  });

  const handleUpload = () => {
    if (selectedFile) {
      uploadMutation.mutate(selectedFile);
    }
  };

  const handleDownload = async (attachment: Attachment) => {
    try {
      const api = (() => {
        try {
          return getServiceNowAPI(settings.servicenow.instanceUrl, settings.servicenow.apiKey);
        } catch {
          return initServiceNowAPI(settings.servicenow.instanceUrl, settings.servicenow.apiKey);
        }
      })();

      const blob = await api.getAttachmentContent(getSysId(attachment.sys_id));
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = attachment.file_name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Download failed:', err);
    }
  };

  const formatFileSize = (bytes: string) => {
    const size = parseInt(bytes, 10);
    if (size < 1024) return `${size} B`;
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />

      {/* Modal */}
      <div className="relative bg-white rounded-xl shadow-xl w-full max-w-4xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-100 rounded-lg">
              <Paperclip className="w-5 h-5 text-blue-600" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-gray-900">
                Contract Attachments
              </h2>
              <p className="text-sm text-gray-500">
                {contractNumber} - Upload and manage contract documents
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
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Upload Section */}
          <div>
            <h3 className="text-sm font-semibold text-gray-900 mb-3">Upload New Attachment</h3>
            
            {/* Validation Status */}
            {validationErrors.length > 0 && (
              <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg">
                <div className="flex items-start gap-3">
                  <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <p className="text-sm font-medium text-red-800 mb-2">
                      Contract validation failed. Please fix these errors:
                    </p>
                    <ul className="list-disc list-inside space-y-1">
                      {validationErrors.map((err, idx) => (
                        <li key={idx} className="text-sm text-red-600">
                          <span className="font-medium">{err.field}:</span> {err.message}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
            )}

            {/* Error Message */}
            {error && validationErrors.length === 0 && (
              <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg">
                <div className="flex items-start gap-3">
                  <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-medium text-red-800">Error</p>
                    <p className="text-sm text-red-600 mt-1">{error}</p>
                  </div>
                </div>
              </div>
            )}

            {/* Upload Zone */}
            {uploadStatus === 'idle' || uploadStatus === 'error' ? (
              <div>
                <div
                  {...getRootProps()}
                  className={clsx(
                    'border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors',
                    isDragActive
                      ? 'border-blue-500 bg-blue-50'
                      : 'border-gray-300 hover:border-gray-400 bg-gray-50'
                  )}
                >
                  <input {...getInputProps()} />
                  <Upload className="w-12 h-12 mx-auto text-gray-400 mb-4" />
                  <p className="text-gray-600 font-medium">
                    {isDragActive
                      ? 'Drop the PDF here...'
                      : 'Drag & drop a PDF contract, or click to select'}
                  </p>
                  <p className="text-sm text-gray-400 mt-2">
                    Only PDF files up to 10MB are supported
                  </p>
                </div>

                {selectedFile && (
                  <div className="mt-4 p-4 bg-blue-50 border border-blue-200 rounded-lg">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <FileText className="w-5 h-5 text-blue-600" />
                        <div>
                          <p className="text-sm font-medium text-gray-900">{selectedFile.name}</p>
                          <p className="text-xs text-gray-500">
                            {(selectedFile.size / (1024 * 1024)).toFixed(2)} MB
                          </p>
                        </div>
                      </div>
                      <button
                        onClick={handleUpload}
                        className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                      >
                        Upload & Validate
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ) : uploadStatus === 'validating' || uploadStatus === 'uploading' ? (
              <div className="text-center py-8">
                <Loader2 className="w-12 h-12 mx-auto text-blue-500 animate-spin mb-4" />
                <p className="text-gray-600 font-medium">
                  {uploadStatus === 'validating' ? 'Validating contract fields...' : 'Uploading to ServiceNow...'}
                </p>
                <div className="w-full bg-gray-200 rounded-full h-2 mt-4 max-w-md mx-auto">
                  <div
                    className="bg-blue-500 h-2 rounded-full transition-all duration-300"
                    style={{ width: `${uploadProgress}%` }}
                  />
                </div>
              </div>
            ) : uploadStatus === 'success' ? (
              <div className="text-center py-8">
                <CheckCircle className="w-12 h-12 mx-auto text-green-500 mb-4" />
                <p className="text-green-600 font-medium">Upload successful!</p>
                <p className="text-sm text-gray-500 mt-2">
                  PDF attached to contract {contractNumber}
                </p>
              </div>
            ) : null}
          </div>

          {/* Existing Attachments */}
          <div>
            <h3 className="text-sm font-semibold text-gray-900 mb-3">Existing Attachments</h3>
            
            {isLoadingAttachments ? (
              <div className="text-center py-8">
                <Loader2 className="w-8 h-8 mx-auto text-gray-400 animate-spin" />
              </div>
            ) : attachments && attachments.length > 0 ? (
              <div className="space-y-2">
                {attachments.map((attachment) => (
                  <div
                    key={getSysId(attachment.sys_id)}
                    className="flex items-center justify-between p-4 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
                  >
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <FileText className="w-5 h-5 text-gray-400 flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900 truncate">
                          {attachment.file_name}
                        </p>
                        <p className="text-xs text-gray-500">
                          {formatFileSize(attachment.size_bytes)} • {attachment.content_type}
                          {attachment.sys_created_on && (
                            <span> • {new Date(attachment.sys_created_on).toLocaleDateString()}</span>
                          )}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleDownload(attachment)}
                        className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                        title="Download"
                      >
                        <Download className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => deleteMutation.mutate(getSysId(attachment.sys_id))}
                        disabled={deleteMutation.isPending}
                        className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50"
                        title="Delete"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 border border-dashed border-gray-300 rounded-lg">
                <Paperclip className="w-8 h-8 mx-auto text-gray-400 mb-2" />
                <p className="text-sm text-gray-500">No attachments found</p>
              </div>
            )}
          </div>

          {/* Info Box */}
          <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
              <div className="text-sm text-blue-700">
                <p className="font-medium mb-1">Validation Requirements</p>
                <p>Before uploading, the system validates that all required contract fields are complete:</p>
                <ul className="list-disc list-inside mt-2 space-y-1">
                  <li>Short Description</li>
                  <li>Vendor</li>
                  <li>Start Date and End Date (End must be after Start)</li>
                  <li>Payment Amount (if specified, must be greater than zero)</li>
                </ul>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end px-6 py-4 border-t border-gray-200 bg-gray-50">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}