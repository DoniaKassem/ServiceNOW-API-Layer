import { useState, useEffect } from 'react';
import {
  X,
  Play,
  Edit3,
  Copy,
  AlertTriangle,
  Clock,
} from 'lucide-react';
import { Light as SyntaxHighlighter } from 'react-syntax-highlighter';
import json from 'react-syntax-highlighter/dist/esm/languages/hljs/json';
import { vs2015 } from 'react-syntax-highlighter/dist/esm/styles/hljs';
import { clsx } from 'clsx';
import { useWorkflowStore } from '../../stores/workflowStore';
import { generateCurlCommand } from '../../stores/requestLogStore';
import type { RequestMethod } from '../../types';

SyntaxHighlighter.registerLanguage('json', json);

interface RequestPreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  onExecute: (modifiedBody?: Record<string, unknown>) => void;
  method: RequestMethod;
  url: string;
  headers: Record<string, string>;
  body?: Record<string, unknown>;
  table: string;
}

export function RequestPreviewModal({
  isOpen,
  onClose,
  onExecute,
  method,
  url,
  headers,
  body,
  table,
}: RequestPreviewModalProps) {
  const { shouldShowCountdown, countdownActive, countdownSeconds, startCountdown, cancelCountdown, decrementCountdown } = useWorkflowStore();
  const [isEditing, setIsEditing] = useState(false);
  const [editedBody, setEditedBody] = useState<string>(JSON.stringify(body || {}, null, 2));
  const [parseError, setParseError] = useState<string | null>(null);

  const showCountdown = shouldShowCountdown(method, table);

  useEffect(() => {
    if (showCountdown && isOpen) {
      startCountdown(`${method}-${table}`);
    }
    return () => {
      cancelCountdown();
    };
  }, [isOpen, showCountdown, method, table, startCountdown, cancelCountdown]);

  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (countdownActive && countdownSeconds > 0) {
      timer = setTimeout(() => {
        decrementCountdown();
      }, 1000);
    } else if (countdownActive && countdownSeconds === 0) {
      handleExecute();
    }
    return () => clearTimeout(timer);
  }, [countdownActive, countdownSeconds, decrementCountdown]);

  const handleExecute = () => {
    cancelCountdown();
    if (isEditing) {
      try {
        const parsed = JSON.parse(editedBody);
        onExecute(parsed);
      } catch {
        setParseError('Invalid JSON. Please fix before executing.');
        return;
      }
    } else {
      onExecute();
    }
    onClose();
  };

  const handleCopyCurl = () => {
    const curl = generateCurlCommand({
      id: '',
      timestamp: new Date(),
      method,
      url,
      headers,
      body: isEditing ? JSON.parse(editedBody) : body,
    });
    navigator.clipboard.writeText(curl);
  };

  const handleBodyChange = (value: string) => {
    setEditedBody(value);
    setParseError(null);
    try {
      JSON.parse(value);
    } catch {
      setParseError('Invalid JSON');
    }
  };

  const getMethodColor = (m: RequestMethod) => {
    const colors: Record<RequestMethod, string> = {
      GET: 'bg-blue-100 text-blue-700',
      POST: 'bg-green-100 text-green-700',
      PATCH: 'bg-yellow-100 text-yellow-700',
      DELETE: 'bg-red-100 text-red-700',
    };
    return colors[m];
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-2xl w-[700px] max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-semibold text-gray-900">Request Preview</h2>
            {countdownActive && (
              <div className="flex items-center gap-2 px-3 py-1 bg-blue-50 text-blue-700 rounded-full text-sm">
                <Clock className="w-4 h-4" />
                Auto-execute in {countdownSeconds}s
              </div>
            )}
          </div>
          <button
            onClick={() => {
              cancelCountdown();
              onClose();
            }}
            className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Method & URL */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className={clsx('px-2 py-1 rounded text-sm font-medium', getMethodColor(method))}>
                {method}
              </span>
              <span className="text-sm text-gray-500">Request</span>
            </div>
            <code className="block text-sm bg-gray-100 p-3 rounded-lg text-gray-700 break-all">
              {url}
            </code>
          </div>

          {/* Headers */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-gray-700">Headers</span>
            </div>
            <div className="bg-gray-900 rounded-lg overflow-hidden">
              <SyntaxHighlighter
                language="json"
                style={vs2015}
                customStyle={{
                  margin: 0,
                  padding: '0.75rem',
                  fontSize: '0.75rem',
                  maxHeight: '120px',
                }}
              >
                {JSON.stringify(
                  Object.fromEntries(
                    Object.entries(headers).map(([k, v]) =>
                      k.toLowerCase().includes('apikey') || k.toLowerCase().includes('authorization')
                        ? [k, '****' + v.slice(-4)]
                        : [k, v]
                    )
                  ),
                  null,
                  2
                )}
              </SyntaxHighlighter>
            </div>
          </div>

          {/* Body */}
          {(body || method !== 'GET') && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-gray-700">Body</span>
                <button
                  onClick={() => setIsEditing(!isEditing)}
                  className={clsx(
                    'flex items-center gap-1 px-2 py-1 text-xs rounded-lg',
                    isEditing
                      ? 'bg-blue-100 text-blue-700'
                      : 'text-gray-500 hover:bg-gray-100'
                  )}
                >
                  <Edit3 className="w-3 h-3" />
                  {isEditing ? 'Editing' : 'Edit'}
                </button>
              </div>

              {isEditing ? (
                <div className="space-y-2">
                  <textarea
                    value={editedBody}
                    onChange={(e) => handleBodyChange(e.target.value)}
                    className="w-full h-64 p-3 font-mono text-sm bg-gray-900 text-gray-100 rounded-lg border-0 focus:ring-2 focus:ring-blue-500"
                    spellCheck={false}
                  />
                  {parseError && (
                    <div className="flex items-center gap-2 text-sm text-red-600">
                      <AlertTriangle className="w-4 h-4" />
                      {parseError}
                    </div>
                  )}
                </div>
              ) : (
                <div className="bg-gray-900 rounded-lg overflow-hidden">
                  <SyntaxHighlighter
                    language="json"
                    style={vs2015}
                    customStyle={{
                      margin: 0,
                      padding: '0.75rem',
                      fontSize: '0.75rem',
                      maxHeight: '250px',
                    }}
                  >
                    {JSON.stringify(body || {}, null, 2)}
                  </SyntaxHighlighter>
                </div>
              )}
            </div>
          )}

          {/* Warnings for destructive operations */}
          {method === 'DELETE' && (
            <div className="flex items-start gap-3 p-3 bg-red-50 border border-red-200 rounded-lg">
              <AlertTriangle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-red-700">Destructive Operation</p>
                <p className="text-sm text-red-600">
                  This will permanently delete the record. This action cannot be undone.
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between p-4 border-t border-gray-200 bg-gray-50">
          <button
            onClick={handleCopyCurl}
            className="flex items-center gap-2 px-3 py-2 text-sm text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-lg"
          >
            <Copy className="w-4 h-4" />
            Copy as cURL
          </button>

          <div className="flex items-center gap-3">
            <button
              onClick={() => {
                cancelCountdown();
                onClose();
              }}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg"
            >
              Cancel
            </button>
            <button
              onClick={handleExecute}
              disabled={isEditing && !!parseError}
              className={clsx(
                'flex items-center gap-2 px-4 py-2 text-sm font-medium text-white rounded-lg',
                method === 'DELETE'
                  ? 'bg-red-600 hover:bg-red-700'
                  : 'bg-blue-600 hover:bg-blue-700',
                isEditing && parseError && 'opacity-50 cursor-not-allowed'
              )}
            >
              {countdownActive ? (
                <>
                  <Clock className="w-4 h-4" />
                  Execute Now
                </>
              ) : (
                <>
                  <Play className="w-4 h-4" />
                  Execute
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
