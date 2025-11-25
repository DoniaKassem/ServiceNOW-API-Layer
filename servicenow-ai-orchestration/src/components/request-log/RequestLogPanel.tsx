import { useState, useMemo, type ReactNode } from 'react';
import {
  X,
  ChevronDown,
  ChevronUp,
  Search,
  Filter,
  Download,
  Trash2,
  Copy,
  ExternalLink,
  Clock,
  CheckCircle,
  XCircle,
  AlertCircle,
} from 'lucide-react';
import { format } from 'date-fns';
import { clsx } from 'clsx';
import { Light as SyntaxHighlighter } from 'react-syntax-highlighter';
import json from 'react-syntax-highlighter/dist/esm/languages/hljs/json';
import { vs2015 } from 'react-syntax-highlighter/dist/esm/styles/hljs';
import {
  useRequestLogStore,
  maskSensitiveHeaders,
  generateCurlCommand,
} from '../../stores/requestLogStore';
import type { RequestLogEntry, RequestMethod } from '../../types';

SyntaxHighlighter.registerLanguage('json', json);

interface RequestLogPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

export function RequestLogPanel({ isOpen, onClose }: RequestLogPanelProps) {
  const { entries, clearLog } = useRequestLogStore();
  const [searchQuery, setSearchQuery] = useState('');
  const [methodFilter, setMethodFilter] = useState<RequestMethod | 'ALL'>('ALL');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'SUCCESS' | 'ERROR'>('ALL');
  const [expandedEntryId, setExpandedEntryId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'request' | 'response'>('request');

  const filteredEntries = useMemo(() => {
    return entries.filter((entry) => {
      // Method filter
      if (methodFilter !== 'ALL' && entry.method !== methodFilter) return false;

      // Status filter
      if (statusFilter === 'SUCCESS' && (entry.responseStatus || 0) >= 400) return false;
      if (statusFilter === 'ERROR' && (entry.responseStatus || 0) < 400) return false;

      // Search filter
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        const matchUrl = entry.url.toLowerCase().includes(query);
        const matchBody = entry.body
          ? JSON.stringify(entry.body).toLowerCase().includes(query)
          : false;
        const matchResponse = entry.responseBody
          ? JSON.stringify(entry.responseBody).toLowerCase().includes(query)
          : false;
        if (!matchUrl && !matchBody && !matchResponse) return false;
      }

      return true;
    });
  }, [entries, searchQuery, methodFilter, statusFilter]);

  const handleCopyCurl = (entry: RequestLogEntry) => {
    const curl = generateCurlCommand(entry);
    navigator.clipboard.writeText(curl);
  };

  const handleExportLog = () => {
    const exportData = filteredEntries.map((entry) => ({
      ...entry,
      headers: maskSensitiveHeaders(entry.headers),
    }));
    const blob = new Blob([JSON.stringify(exportData, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `request-log-${format(new Date(), 'yyyy-MM-dd-HHmmss')}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const getStatusIcon = (status?: number) => {
    if (!status) return <Clock className="w-4 h-4 text-gray-400" />;
    if (status >= 200 && status < 300)
      return <CheckCircle className="w-4 h-4 text-green-500" />;
    if (status >= 400 && status < 500)
      return <AlertCircle className="w-4 h-4 text-yellow-500" />;
    if (status >= 500) return <XCircle className="w-4 h-4 text-red-500" />;
    return <Clock className="w-4 h-4 text-gray-400" />;
  };

  const getMethodColor = (method: RequestMethod) => {
    const colors: Record<RequestMethod, string> = {
      GET: 'bg-blue-100 text-blue-700',
      POST: 'bg-green-100 text-green-700',
      PATCH: 'bg-yellow-100 text-yellow-700',
      DELETE: 'bg-red-100 text-red-700',
    };
    return colors[method] || 'bg-gray-100 text-gray-700';
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-y-0 right-0 w-[600px] bg-white shadow-2xl border-l border-gray-200 flex flex-col z-50">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-gray-200">
        <h2 className="text-lg font-semibold text-gray-900">Request Log</h2>
        <div className="flex items-center gap-2">
          <button
            onClick={handleExportLog}
            className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg"
            title="Export Log"
          >
            <Download className="w-4 h-4" />
          </button>
          <button
            onClick={clearLog}
            className="p-2 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-lg"
            title="Clear Log"
          >
            <Trash2 className="w-4 h-4" />
          </button>
          <button
            onClick={onClose}
            className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="p-4 border-b border-gray-200 space-y-3">
        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search requests..."
            className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
        </div>

        {/* Filter buttons */}
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-gray-400" />
            <select
              value={methodFilter}
              onChange={(e) => setMethodFilter(e.target.value as RequestMethod | 'ALL')}
              className="text-sm border border-gray-300 rounded-lg px-2 py-1 focus:ring-2 focus:ring-blue-500"
            >
              <option value="ALL">All Methods</option>
              <option value="GET">GET</option>
              <option value="POST">POST</option>
              <option value="PATCH">PATCH</option>
              <option value="DELETE">DELETE</option>
            </select>
          </div>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as 'ALL' | 'SUCCESS' | 'ERROR')}
            className="text-sm border border-gray-300 rounded-lg px-2 py-1 focus:ring-2 focus:ring-blue-500"
          >
            <option value="ALL">All Status</option>
            <option value="SUCCESS">Success (2xx)</option>
            <option value="ERROR">Error (4xx/5xx)</option>
          </select>

          <span className="text-sm text-gray-500 ml-auto">
            {filteredEntries.length} of {entries.length} requests
          </span>
        </div>
      </div>

      {/* Request List */}
      <div className="flex-1 overflow-y-auto">
        {filteredEntries.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-500">
            <Clock className="w-12 h-12 mb-4" />
            <p className="text-lg">No requests logged yet</p>
            <p className="text-sm">API requests will appear here</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {filteredEntries.map((entry) => (
              <RequestLogEntry
                key={entry.id}
                entry={entry}
                isExpanded={expandedEntryId === entry.id}
                onToggle={() =>
                  setExpandedEntryId(expandedEntryId === entry.id ? null : entry.id)
                }
                activeTab={activeTab}
                onTabChange={setActiveTab}
                onCopyCurl={() => handleCopyCurl(entry)}
                getStatusIcon={getStatusIcon}
                getMethodColor={getMethodColor}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

interface RequestLogEntryProps {
  entry: RequestLogEntry;
  isExpanded: boolean;
  onToggle: () => void;
  activeTab: 'request' | 'response';
  onTabChange: (tab: 'request' | 'response') => void;
  onCopyCurl: () => void;
  getStatusIcon: (status?: number) => ReactNode;
  getMethodColor: (method: RequestMethod) => string;
}

function RequestLogEntry({
  entry,
  isExpanded,
  onToggle,
  activeTab,
  onTabChange,
  onCopyCurl,
  getStatusIcon,
  getMethodColor,
}: RequestLogEntryProps) {
  const extractTableFromUrl = (url: string): string => {
    const match = url.match(/\/table\/([^/?]+)/);
    return match ? match[1] : '';
  };

  return (
    <div className="group">
      {/* Summary Row */}
      <div
        onClick={onToggle}
        className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-gray-50"
      >
        {getStatusIcon(entry.responseStatus)}

        <span
          className={clsx(
            'px-2 py-0.5 rounded text-xs font-medium',
            getMethodColor(entry.method)
          )}
        >
          {entry.method}
        </span>

        <span className="text-sm text-gray-600 truncate flex-1">
          {entry.table || extractTableFromUrl(entry.url)}
        </span>

        <span className="text-xs text-gray-400">
          {format(new Date(entry.timestamp), 'HH:mm:ss')}
        </span>

        {entry.duration && (
          <span className="text-xs text-gray-400">{entry.duration}ms</span>
        )}

        {entry.responseStatus && (
          <span
            className={clsx(
              'text-xs font-medium',
              entry.responseStatus >= 200 && entry.responseStatus < 300
                ? 'text-green-600'
                : entry.responseStatus >= 400
                ? 'text-red-600'
                : 'text-gray-600'
            )}
          >
            {entry.responseStatus}
          </span>
        )}

        {isExpanded ? (
          <ChevronUp className="w-4 h-4 text-gray-400" />
        ) : (
          <ChevronDown className="w-4 h-4 text-gray-400" />
        )}
      </div>

      {/* Expanded Details */}
      {isExpanded && (
        <div className="px-4 pb-4 bg-gray-50 border-t border-gray-100">
          {/* URL */}
          <div className="mt-3 mb-3">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-medium text-gray-500">URL</span>
              <div className="flex gap-1">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onCopyCurl();
                  }}
                  className="p-1 text-gray-400 hover:text-gray-600 rounded"
                  title="Copy as cURL"
                >
                  <Copy className="w-3 h-3" />
                </button>
                <a
                  href={entry.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="p-1 text-gray-400 hover:text-gray-600 rounded"
                  title="Open URL"
                >
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            </div>
            <code className="block text-xs bg-gray-100 p-2 rounded text-gray-700 break-all">
              {entry.url}
            </code>
          </div>

          {/* Tabs */}
          <div className="flex gap-1 mb-3">
            <button
              onClick={(e) => {
                e.stopPropagation();
                onTabChange('request');
              }}
              className={clsx(
                'px-3 py-1 text-xs font-medium rounded-lg',
                activeTab === 'request'
                  ? 'bg-blue-100 text-blue-700'
                  : 'text-gray-600 hover:bg-gray-100'
              )}
            >
              Request
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onTabChange('response');
              }}
              className={clsx(
                'px-3 py-1 text-xs font-medium rounded-lg',
                activeTab === 'response'
                  ? 'bg-blue-100 text-blue-700'
                  : 'text-gray-600 hover:bg-gray-100'
              )}
            >
              Response
            </button>
          </div>

          {/* Content */}
          {activeTab === 'request' ? (
            <div className="space-y-3">
              {/* Headers */}
              <div>
                <span className="text-xs font-medium text-gray-500 block mb-1">
                  Headers
                </span>
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
                    {JSON.stringify(maskSensitiveHeaders(entry.headers), null, 2)}
                  </SyntaxHighlighter>
                </div>
              </div>

              {/* Body */}
              {entry.body && Object.keys(entry.body).length > 0 && (
                <div>
                  <span className="text-xs font-medium text-gray-500 block mb-1">
                    Body
                  </span>
                  <div className="bg-gray-900 rounded-lg overflow-hidden">
                    <SyntaxHighlighter
                      language="json"
                      style={vs2015}
                      customStyle={{
                        margin: 0,
                        padding: '0.75rem',
                        fontSize: '0.75rem',
                        maxHeight: '200px',
                      }}
                    >
                      {JSON.stringify(entry.body, null, 2)}
                    </SyntaxHighlighter>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              {/* Status */}
              <div className="flex items-center gap-4">
                <div>
                  <span className="text-xs font-medium text-gray-500 block mb-1">
                    Status
                  </span>
                  <span
                    className={clsx(
                      'text-sm font-medium',
                      entry.responseStatus && entry.responseStatus >= 200 && entry.responseStatus < 300
                        ? 'text-green-600'
                        : 'text-red-600'
                    )}
                  >
                    {entry.responseStatus || 'N/A'}
                  </span>
                </div>
                {entry.duration && (
                  <div>
                    <span className="text-xs font-medium text-gray-500 block mb-1">
                      Duration
                    </span>
                    <span className="text-sm text-gray-700">{entry.duration}ms</span>
                  </div>
                )}
              </div>

              {/* Response Body */}
              {entry.responseBody != null && (
                <div>
                  <span className="text-xs font-medium text-gray-500 block mb-1">
                    Response Body
                  </span>
                  <div className="bg-gray-900 rounded-lg overflow-hidden">
                    <SyntaxHighlighter
                      language="json"
                      style={vs2015}
                      customStyle={{
                        margin: 0,
                        padding: '0.75rem',
                        fontSize: '0.75rem',
                        maxHeight: '300px',
                      }}
                    >
                      {typeof entry.responseBody === 'string'
                        ? entry.responseBody
                        : JSON.stringify(entry.responseBody, null, 2)}
                    </SyntaxHighlighter>
                  </div>
                </div>
              )}

              {/* Error */}
              {entry.error && (
                <div>
                  <span className="text-xs font-medium text-red-500 block mb-1">
                    Error
                  </span>
                  <div className="bg-red-50 border border-red-200 rounded-lg p-2">
                    <p className="text-sm text-red-700">{entry.error}</p>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
