import { useState, useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import {
  Upload,
  FileText,
  Loader2,
  CheckCircle,
  AlertTriangle,
  X,
  FileType,
  Brain,
} from 'lucide-react';
import { clsx } from 'clsx';
import { extractText } from '../../services/ocr';
import { getOpenAIService } from '../../services/openai';
import { useSessionStore } from '../../stores/sessionStore';
import { useSettingsStore } from '../../stores/settingsStore';
import type { DocumentClassification, DocumentType, ExtractedData } from '../../types';

interface UploadState {
  file: File | null;
  status: 'idle' | 'uploading' | 'extracting' | 'classifying' | 'extracting_data' | 'complete' | 'error';
  progress: number;
  progressText: string;
  extractedText: string;
  classification: DocumentClassification | null;
  extractedData: ExtractedData | null;
  error: string | null;
}

export function DocumentUpload() {
  const { createSession, setExtractedData } = useSessionStore();
  const { settings } = useSettingsStore();

  const [uploadState, setUploadState] = useState<UploadState>({
    file: null,
    status: 'idle',
    progress: 0,
    progressText: '',
    extractedText: '',
    classification: null,
    extractedData: null,
    error: null,
  });

  const [selectedDocType, setSelectedDocType] = useState<DocumentType | null>(null);

  const processDocument = useCallback(async (file: File) => {
    setUploadState({
      file,
      status: 'extracting',
      progress: 10,
      progressText: 'Extracting text from document...',
      extractedText: '',
      classification: null,
      extractedData: null,
      error: null,
    });

    try {
      // Step 1: Extract text via OCR
      const ocrResult = await extractText(file, (progress, status) => {
        setUploadState((prev) => ({
          ...prev,
          progress: 10 + progress * 0.3,
          progressText: status,
        }));
      });

      setUploadState((prev) => ({
        ...prev,
        extractedText: ocrResult.text,
        status: 'classifying',
        progress: 40,
        progressText: 'Classifying document type...',
      }));

      // Step 2: Classify document
      if (!settings.openai.apiKey) {
        throw new Error('OpenAI API key not configured. Please update settings.');
      }

      const openai = getOpenAIService(
        settings.openai.apiKey,
        settings.openai.model,
        settings.openai.temperature,
        settings.openai.maxTokens
      );

      const classification = await openai.classifyDocument(ocrResult.text);

      setUploadState((prev) => ({
        ...prev,
        classification,
        status: 'extracting_data',
        progress: 60,
        progressText: 'Extracting structured data...',
      }));

      // Step 3: Extract structured data based on document type
      const extractedData = await openai.extractFullDocument(
        ocrResult.text,
        selectedDocType || classification.type
      );

      // Step 4: Create session and store data
      const sessionId = createSession(file.name);
      setExtractedData(sessionId, extractedData);

      setUploadState((prev) => ({
        ...prev,
        extractedData,
        status: 'complete',
        progress: 100,
        progressText: 'Processing complete!',
      }));
    } catch (error) {
      console.error('Document processing error:', error);
      setUploadState((prev) => ({
        ...prev,
        status: 'error',
        error: error instanceof Error ? error.message : 'An error occurred',
      }));
    }
  }, [createSession, setExtractedData, settings.openai, selectedDocType]);

  const onDrop = useCallback(
    (acceptedFiles: File[]) => {
      const file = acceptedFiles[0];
      if (file) {
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
    disabled: uploadState.status !== 'idle' && uploadState.status !== 'complete' && uploadState.status !== 'error',
  });

  const resetUpload = () => {
    setUploadState({
      file: null,
      status: 'idle',
      progress: 0,
      progressText: '',
      extractedText: '',
      classification: null,
      extractedData: null,
      error: null,
    });
    setSelectedDocType(null);
  };

  const getConfidenceColor = (confidence: number) => {
    if (confidence >= 80) return 'text-green-600 bg-green-50';
    if (confidence >= 50) return 'text-yellow-600 bg-yellow-50';
    return 'text-red-600 bg-red-50';
  };

  return (
    <div className="p-6">
      <div className="flex items-center gap-3 mb-6">
        <FileText className="w-8 h-8 text-gray-700" />
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Document Processing</h1>
          <p className="text-gray-500">Upload and extract data from procurement documents</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-6">
        {/* Upload Zone */}
        <div className="space-y-4">
          <div
            {...getRootProps()}
            className={clsx(
              'border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors',
              isDragActive
                ? 'border-blue-500 bg-blue-50'
                : uploadState.status === 'error'
                ? 'border-red-300 bg-red-50'
                : 'border-gray-300 hover:border-gray-400 bg-white'
            )}
          >
            <input {...getInputProps()} />

            {uploadState.status === 'idle' && (
              <>
                <Upload className="w-12 h-12 mx-auto text-gray-400 mb-4" />
                <p className="text-gray-600 font-medium">
                  {isDragActive
                    ? 'Drop the file here...'
                    : 'Drag & drop a document, or click to select'}
                </p>
                <p className="text-sm text-gray-400 mt-2">
                  Supports PDF, DOCX, and images (PNG, JPG)
                </p>
              </>
            )}

            {(uploadState.status === 'extracting' ||
              uploadState.status === 'classifying' ||
              uploadState.status === 'extracting_data') && (
              <>
                <Loader2 className="w-12 h-12 mx-auto text-blue-500 animate-spin mb-4" />
                <p className="text-gray-600 font-medium">{uploadState.progressText}</p>
                <div className="w-full bg-gray-200 rounded-full h-2 mt-4">
                  <div
                    className="bg-blue-500 h-2 rounded-full transition-all duration-300"
                    style={{ width: `${uploadState.progress}%` }}
                  />
                </div>
              </>
            )}

            {uploadState.status === 'complete' && (
              <>
                <CheckCircle className="w-12 h-12 mx-auto text-green-500 mb-4" />
                <p className="text-green-600 font-medium">Processing complete!</p>
                <p className="text-sm text-gray-500 mt-2">{uploadState.file?.name}</p>
              </>
            )}

            {uploadState.status === 'error' && (
              <>
                <AlertTriangle className="w-12 h-12 mx-auto text-red-500 mb-4" />
                <p className="text-red-600 font-medium">Error processing document</p>
                <p className="text-sm text-red-500 mt-2">{uploadState.error}</p>
              </>
            )}
          </div>

          {(uploadState.status === 'complete' || uploadState.status === 'error') && (
            <button
              onClick={resetUpload}
              className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-800"
            >
              <X className="w-4 h-4" />
              Process another document
            </button>
          )}

          {/* Manual Document Type Selection */}
          {uploadState.status === 'idle' && (
            <div className="bg-white rounded-lg border border-gray-200 p-4">
              <h3 className="text-sm font-medium text-gray-700 mb-2">
                Optional: Pre-select document type
              </h3>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { type: 'contract', label: 'Contract/SOW' },
                  { type: 'amendment', label: 'Amendment' },
                  { type: 'purchase_order', label: 'Purchase Order' },
                  { type: 'invoice', label: 'Invoice' },
                ].map(({ type, label }) => (
                  <button
                    key={type}
                    onClick={() =>
                      setSelectedDocType(
                        selectedDocType === type ? null : (type as DocumentType)
                      )
                    }
                    className={clsx(
                      'px-3 py-2 text-sm rounded-lg border transition-colors',
                      selectedDocType === type
                        ? 'border-blue-500 bg-blue-50 text-blue-700'
                        : 'border-gray-200 hover:border-gray-300 text-gray-600'
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Classification & Extraction Results */}
        <div className="space-y-4">
          {/* Classification Result */}
          {uploadState.classification && (
            <div className="bg-white rounded-lg border border-gray-200 p-4">
              <div className="flex items-center gap-2 mb-3">
                <FileType className="w-5 h-5 text-gray-600" />
                <h3 className="font-medium text-gray-900">Document Classification</h3>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-gray-600">Detected Type:</span>
                  <span className="font-medium text-gray-900 capitalize">
                    {uploadState.classification.type.replace('_', ' ')}
                  </span>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-gray-600">Confidence:</span>
                  <span
                    className={clsx(
                      'px-2 py-0.5 rounded-full text-sm font-medium',
                      getConfidenceColor(uploadState.classification.confidence)
                    )}
                  >
                    {uploadState.classification.confidence}%
                  </span>
                </div>

                {uploadState.classification.confidence < 80 && (
                  <div className="flex items-start gap-2 p-2 bg-yellow-50 rounded-lg mt-2">
                    <AlertTriangle className="w-4 h-4 text-yellow-600 mt-0.5" />
                    <p className="text-sm text-yellow-700">
                      Low confidence classification. Please verify the document type.
                    </p>
                  </div>
                )}

                <p className="text-sm text-gray-500 mt-2">
                  {uploadState.classification.reasoning}
                </p>
              </div>
            </div>
          )}

          {/* Extracted Data Summary */}
          {uploadState.extractedData && (
            <div className="bg-white rounded-lg border border-gray-200 p-4">
              <div className="flex items-center gap-2 mb-3">
                <Brain className="w-5 h-5 text-gray-600" />
                <h3 className="font-medium text-gray-900">Extracted Data</h3>
              </div>

              <div className="space-y-3">
                {uploadState.extractedData.vendor && (
                  <div className="p-2 bg-gray-50 rounded">
                    <h4 className="text-sm font-medium text-gray-700">Vendor</h4>
                    <p className="text-sm text-gray-600">
                      {uploadState.extractedData.vendor.name || 'Not detected'}
                    </p>
                  </div>
                )}

                {uploadState.extractedData.supplier && (
                  <div className="p-2 bg-gray-50 rounded">
                    <h4 className="text-sm font-medium text-gray-700">Supplier</h4>
                    <p className="text-sm text-gray-600">
                      {uploadState.extractedData.supplier.name || 'Not detected'}
                    </p>
                  </div>
                )}

                {uploadState.extractedData.contract && (
                  <div className="p-2 bg-gray-50 rounded">
                    <h4 className="text-sm font-medium text-gray-700">Contract</h4>
                    <p className="text-sm text-gray-600">
                      {uploadState.extractedData.contract.short_description || 'Not detected'}
                    </p>
                    {uploadState.extractedData.contract.starts && (
                      <p className="text-xs text-gray-500">
                        {uploadState.extractedData.contract.starts} -{' '}
                        {uploadState.extractedData.contract.ends}
                      </p>
                    )}
                  </div>
                )}

                {uploadState.extractedData.purchaseOrder && (
                  <div className="p-2 bg-gray-50 rounded">
                    <h4 className="text-sm font-medium text-gray-700">Purchase Order</h4>
                    <p className="text-sm text-gray-600">
                      {uploadState.extractedData.purchaseOrder.display_name || 'Not detected'}
                    </p>
                  </div>
                )}

                {uploadState.extractedData.expenseLines &&
                  uploadState.extractedData.expenseLines.length > 0 && (
                    <div className="p-2 bg-gray-50 rounded">
                      <h4 className="text-sm font-medium text-gray-700">Expense Lines</h4>
                      <p className="text-sm text-gray-600">
                        {uploadState.extractedData.expenseLines.length} line items detected
                      </p>
                    </div>
                  )}

                {uploadState.extractedData.purchaseOrderLines &&
                  uploadState.extractedData.purchaseOrderLines.length > 0 && (
                    <div className="p-2 bg-gray-50 rounded">
                      <h4 className="text-sm font-medium text-gray-700">PO Lines</h4>
                      <p className="text-sm text-gray-600">
                        {uploadState.extractedData.purchaseOrderLines.length} line items detected
                      </p>
                    </div>
                  )}

                <p className="text-xs text-gray-400">
                  {uploadState.extractedData.rawEntities.length} total fields extracted
                </p>
              </div>
            </div>
          )}

          {/* Extracted Text Preview */}
          {uploadState.extractedText && (
            <div className="bg-white rounded-lg border border-gray-200 p-4">
              <h3 className="font-medium text-gray-900 mb-2">Extracted Text Preview</h3>
              <div className="max-h-48 overflow-y-auto text-sm text-gray-600 bg-gray-50 p-3 rounded font-mono whitespace-pre-wrap">
                {uploadState.extractedText.substring(0, 2000)}
                {uploadState.extractedText.length > 2000 && '...'}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
