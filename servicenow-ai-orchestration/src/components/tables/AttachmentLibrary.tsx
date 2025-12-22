import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  X,
  Paperclip,
  Loader2,
  FileText,
  Download,
  Search,
  Filter,
  Calendar,
  File,
} from 'lucide-react';
import { clsx } from 'clsx';
import { useSettingsStore } from '../../stores/settingsStore';
import { getServiceNowAPI, initServiceNowAPI } from '../../services/servicenow';
import { getSysId } from '../../utils/serviceNowHelpers';
import type { Attachment } from '../../types';

interface AttachmentLibraryProps {
  onClose: () => void;
  onContractClick?: (contractSysId: string) => void;
}

interface AttachmentWithContract extends Attachment {
  contract_number?: string;
  contract_description?: string;
}

export function AttachmentLibrary({ onClose, onContractClick }: AttachmentLibraryProps) {
  const { settings } = useSettingsStore();
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState<'all' | 'pdf'>('all');
  const [sortBy, setSortBy] = useState<'date' | 'name' | 'size'>('date');

  // Fetch all contract attachments
  const { data: attachments, isLoading, error } = useQuery({
    queryKey: ['all-contract-attachments'],
    queryFn: async () => {
      const api = (() => {
        try {
          return getServiceNowAPI(settings.servicenow.instanceUrl, settings.servicenow.apiKey);
        } catch {
          return initServiceNowAPI(settings.servicenow.instanceUrl, settings.servicenow.apiKey);
        }
      })();
      
      const response = await api.getAllContractAttachments();
      
      // Fetch contract details for each attachment
      const attachmentsWithContracts = await Promise.all(
        response.result.map(async (attachment) => {
          try {
            const contractResponse = await api.getContractById(getSysId(attachment.table_sys_id));
            return {
              ...attachment,
              contract_number: contractResponse.result.number,
              contract_description: contractResponse.result.short_description,
            } as AttachmentWithContract;
          } catch {
            return {
              ...attachment,
              contract_number: 'Unknown',
              contract_description: '',
            } as AttachmentWithContract;
          }
        })
      );
      
      return attachmentsWithContracts;
    },
    staleTime: 30000, // 30 seconds
  });

  // Filter and sort attachments
  const filteredAttachments = useMemo(() => {
    if (!attachments) return [];

    let filtered = attachments;

    // Apply search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (att) =>
          att.file_name.toLowerCase().includes(query) ||
          att.contract_number?.toLowerCase().includes(query) ||
          att.contract_description?.toLowerCase().includes(query)
      );
    }

    // Apply type filter
    if (filterType === 'pdf') {
      filtered = filtered.filter((att) => att.content_type === 'application/pdf');
    }

    // Apply sorting
    filtered.sort((a, b) => {
      switch (sortBy) {
        case 'date':
          return new Date(b.sys_created_on || 0).getTime() - new Date(a.sys_created_on || 0).getTime();
        case 'name':
          return a.file_name.localeCompare(b.file_name);
        case 'size':
          return parseInt(b.size_bytes || '0') - parseInt(a.size_bytes || '0');
        default:
          return 0;
      }
    });

    return filtered;
  }, [attachments, searchQuery, filterType, sortBy]);

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

  const stats = useMemo(() => {
    if (!attachments) return { total: 0, pdf: 0, totalSize: 0 };
    
    return {
      total: attachments.length,
      pdf: attachments.filter((att) => att.content_type === 'application/pdf').length,
      totalSize: attachments.reduce((sum, att) => sum + parseInt(att.size_bytes || '0', 10), 0),
    };
  }, [attachments]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />

      {/* Modal */}
      <div className="relative bg-white rounded-xl shadow-xl w-full max-w-6xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-indigo-100 rounded-lg">
              <Paperclip className="w-5 h-5 text-indigo-600" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-gray-900">
                Contract Attachment Library
              </h2>
              <p className="text-sm text-gray-500">
                View and download all contract PDF attachments
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

        {/* Stats Bar */}
        <div className="px-6 py-4 bg-gray-50 border-b border-gray-200">
          <div className="grid grid-cols-3 gap-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-100 rounded-lg">
                <File className="w-5 h-5 text-blue-600" />
              </div>
              <div>
                <p className="text-sm text-gray-500">Total Attachments</p>
                <p className="text-xl font-semibold text-gray-900">{stats.total}</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="p-2 bg-red-100 rounded-lg">
                <FileText className="w-5 h-5 text-red-600" />
              </div>
              <div>
                <p className="text-sm text-gray-500">PDF Files</p>
                <p className="text-xl font-semibold text-gray-900">{stats.pdf}</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="p-2 bg-green-100 rounded-lg">
                <Download className="w-5 h-5 text-green-600" />
              </div>
              <div>
                <p className="text-sm text-gray-500">Total Size</p>
                <p className="text-xl font-semibold text-gray-900">
                  {(stats.totalSize / (1024 * 1024)).toFixed(1)} MB
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Filters */}
        <div className="px-6 py-4 border-b border-gray-200">
          <div className="flex items-center gap-4">
            {/* Search */}
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search by filename or contract..."
                className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
              />
            </div>

            {/* Type Filter */}
            <div className="flex items-center gap-2">
              <Filter className="w-4 h-4 text-gray-500" />
              <select
                value={filterType}
                onChange={(e) => setFilterType(e.target.value as 'all' | 'pdf')}
                className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
              >
                <option value="all">All Types</option>
                <option value="pdf">PDF Only</option>
              </select>
            </div>

            {/* Sort */}
            <div className="flex items-center gap-2">
              <Calendar className="w-4 h-4 text-gray-500" />
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as 'date' | 'name' | 'size')}
                className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
              >
                <option value="date">Sort by Date</option>
                <option value="name">Sort by Name</option>
                <option value="size">Sort by Size</option>
              </select>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {isLoading ? (
            <div className="text-center py-12">
              <Loader2 className="w-12 h-12 mx-auto text-indigo-500 animate-spin mb-4" />
              <p className="text-gray-600">Loading attachments...</p>
            </div>
          ) : error ? (
            <div className="text-center py-12">
              <div className="text-red-500 mb-2">⚠️</div>
              <p className="text-gray-600">Failed to load attachments</p>
            </div>
          ) : filteredAttachments.length === 0 ? (
            <div className="text-center py-12">
              <Paperclip className="w-12 h-12 mx-auto text-gray-400 mb-4" />
              <p className="text-gray-600 font-medium">No attachments found</p>
              <p className="text-sm text-gray-500 mt-2">
                {searchQuery ? 'Try adjusting your search criteria' : 'No contract attachments in the system'}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {filteredAttachments.map((attachment) => (
                <div
                  key={getSysId(attachment.sys_id)}
                  className="border border-gray-200 rounded-lg p-4 hover:shadow-md transition-shadow"
                >
                  <div className="flex items-start gap-3">
                    <div className="p-2 bg-red-50 rounded-lg flex-shrink-0">
                      <FileText className="w-5 h-5 text-red-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h4 className="text-sm font-semibold text-gray-900 truncate mb-1">
                        {attachment.file_name}
                      </h4>
                      
                      {/* Contract Info */}
                      <div className="mb-2">
                        <button
                          onClick={() => onContractClick?.(getSysId(attachment.table_sys_id))}
                          className="text-xs text-blue-600 hover:text-blue-800 hover:underline"
                        >
                          {attachment.contract_number || 'Unknown Contract'}
                        </button>
                        {attachment.contract_description && (
                          <p className="text-xs text-gray-500 truncate mt-0.5">
                            {attachment.contract_description}
                          </p>
                        )}
                      </div>

                      {/* File Info */}
                      <div className="flex items-center gap-3 text-xs text-gray-500 mb-3">
                        <span>{formatFileSize(attachment.size_bytes)}</span>
                        <span>•</span>
                        <span>{attachment.content_type}</span>
                        {attachment.sys_created_on && (
                          <>
                            <span>•</span>
                            <span>{new Date(attachment.sys_created_on).toLocaleDateString()}</span>
                          </>
                        )}
                      </div>

                      {/* Actions */}
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handleDownload(attachment)}
                          className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-white bg-indigo-600 rounded hover:bg-indigo-700 transition-colors"
                        >
                          <Download className="w-3 h-3" />
                          Download
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-gray-200 bg-gray-50">
          <p className="text-sm text-gray-500">
            Showing {filteredAttachments.length} of {stats.total} attachments
          </p>
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