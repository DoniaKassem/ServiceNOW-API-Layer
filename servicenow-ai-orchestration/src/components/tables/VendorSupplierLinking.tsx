import { useState, useCallback } from 'react';
import {
  X,
  Link2,
  Plus,
  Search,
  Loader2,
  CheckCircle,
  AlertTriangle,
  Building2,
  Users,
} from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { clsx } from 'clsx';
import { useSettingsStore } from '../../stores/settingsStore';
import { useRequestLogStore } from '../../stores/requestLogStore';
import { getServiceNowAPI, initServiceNowAPI } from '../../services/servicenow';
import { getSysId, getDisplayValue } from '../../utils/serviceNowHelpers';

interface VendorSupplierLinkingProps {
  mode: 'vendor' | 'supplier';
  recordSysId: string;
  recordName: string;
  linkedSysId?: string;
  linkedName?: string;
  onClose: () => void;
  onSuccess: () => void;
}

export function VendorSupplierLinking({
  mode,
  recordSysId,
  recordName,
  linkedSysId,
  linkedName,
  onClose,
  onSuccess,
}: VendorSupplierLinkingProps) {
  const { settings } = useSettingsStore();
  const { addEntry, updateEntry } = useRequestLogStore();
  const queryClient = useQueryClient();

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedRecord, setSelectedRecord] = useState<Record<string, unknown> | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newRecordName, setNewRecordName] = useState('');

  const isLinkingSupplier = mode === 'vendor'; // If viewing vendor, we link a supplier
  const targetTable = isLinkingSupplier ? 'sn_fin_supplier' : 'core_company';
  const targetLabel = isLinkingSupplier ? 'Supplier' : 'Vendor';

  // Get API instance
  const getApi = useCallback(() => {
    if (!settings.servicenow.apiKey || !settings.servicenow.instanceUrl) {
      throw new Error('API not configured');
    }
    try {
      return getServiceNowAPI(settings.servicenow.instanceUrl, settings.servicenow.apiKey);
    } catch {
      return initServiceNowAPI(settings.servicenow.instanceUrl, settings.servicenow.apiKey);
    }
  }, [settings.servicenow]);

  // Search for records to link
  const { data: searchResults, isLoading: isSearching } = useQuery({
    queryKey: ['link-search', targetTable, searchQuery],
    queryFn: async () => {
      if (!searchQuery || searchQuery.length < 2) return [];

      const api = getApi();
      let query = `nameLIKE${searchQuery}`;

      // For vendors, add vendor=true filter
      if (!isLinkingSupplier) {
        query = `vendor=true^${query}`;
      }

      const response = await api.get<Record<string, unknown>>(targetTable, {
        sysparm_query: query,
        sysparm_limit: 10,
        sysparm_display_value: 'all',
      });

      return response.result || [];
    },
    enabled: searchQuery.length >= 2 && !!settings.servicenow.apiKey,
  });

  // Link mutation
  const linkMutation = useMutation({
    mutationFn: async (targetSysId: string) => {
      const api = getApi();

      if (isLinkingSupplier) {
        // Linking supplier to vendor:
        // 1. Update vendor's supplier field
        // 2. Update supplier's u_vendor field

        const startTime = Date.now();

        // Update vendor with supplier reference
        const vendorLogId = addEntry({
          method: 'PATCH',
          url: `${settings.servicenow.instanceUrl}/api/now/table/core_company/${recordSysId}`,
          table: 'core_company',
          recordSysId,
          headers: {
            'Content-Type': 'application/json',
            'x-sn-apikey': settings.servicenow.apiKey,
          },
          body: { supplier: targetSysId },
        });

        try {
          await api.update('core_company', recordSysId, { supplier: targetSysId });
          updateEntry(vendorLogId, {
            responseStatus: 200,
            duration: Date.now() - startTime,
          });
        } catch (err: any) {
          updateEntry(vendorLogId, {
            responseStatus: err.response?.status || 500,
            error: err.message,
            duration: Date.now() - startTime,
          });
          throw err;
        }

        // Update supplier with vendor reference
        const supplierLogId = addEntry({
          method: 'PATCH',
          url: `${settings.servicenow.instanceUrl}/api/now/table/sn_fin_supplier/${targetSysId}`,
          table: 'sn_fin_supplier',
          recordSysId: targetSysId,
          headers: {
            'Content-Type': 'application/json',
            'x-sn-apikey': settings.servicenow.apiKey,
          },
          body: { u_vendor: recordSysId },
        });

        try {
          await api.update('sn_fin_supplier', targetSysId, { u_vendor: recordSysId });
          updateEntry(supplierLogId, {
            responseStatus: 200,
            duration: Date.now() - startTime,
          });
        } catch (err: any) {
          updateEntry(supplierLogId, {
            responseStatus: err.response?.status || 500,
            error: err.message,
            duration: Date.now() - startTime,
          });
          throw err;
        }
      } else {
        // Linking vendor to supplier:
        // 1. Update supplier's u_vendor field
        // 2. Update vendor's supplier field

        const startTime = Date.now();

        // Update supplier with vendor reference
        const supplierLogId = addEntry({
          method: 'PATCH',
          url: `${settings.servicenow.instanceUrl}/api/now/table/sn_fin_supplier/${recordSysId}`,
          table: 'sn_fin_supplier',
          recordSysId,
          headers: {
            'Content-Type': 'application/json',
            'x-sn-apikey': settings.servicenow.apiKey,
          },
          body: { u_vendor: targetSysId },
        });

        try {
          await api.update('sn_fin_supplier', recordSysId, { u_vendor: targetSysId });
          updateEntry(supplierLogId, {
            responseStatus: 200,
            duration: Date.now() - startTime,
          });
        } catch (err: any) {
          updateEntry(supplierLogId, {
            responseStatus: err.response?.status || 500,
            error: err.message,
            duration: Date.now() - startTime,
          });
          throw err;
        }

        // Update vendor with supplier reference
        const vendorLogId = addEntry({
          method: 'PATCH',
          url: `${settings.servicenow.instanceUrl}/api/now/table/core_company/${targetSysId}`,
          table: 'core_company',
          recordSysId: targetSysId,
          headers: {
            'Content-Type': 'application/json',
            'x-sn-apikey': settings.servicenow.apiKey,
          },
          body: { supplier: recordSysId },
        });

        try {
          await api.update('core_company', targetSysId, { supplier: recordSysId });
          updateEntry(vendorLogId, {
            responseStatus: 200,
            duration: Date.now() - startTime,
          });
        } catch (err: any) {
          updateEntry(vendorLogId, {
            responseStatus: err.response?.status || 500,
            error: err.message,
            duration: Date.now() - startTime,
          });
          throw err;
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['table'] });
      onSuccess();
    },
  });

  // Create and link mutation
  const createAndLinkMutation = useMutation({
    mutationFn: async (name: string) => {
      const api = getApi();
      const startTime = Date.now();

      if (isLinkingSupplier) {
        // Create new supplier
        const createLogId = addEntry({
          method: 'POST',
          url: `${settings.servicenow.instanceUrl}/api/now/table/sn_fin_supplier`,
          table: 'sn_fin_supplier',
          headers: {
            'Content-Type': 'application/json',
            'x-sn-apikey': settings.servicenow.apiKey,
          },
          body: { name, u_vendor: recordSysId },
        });

        try {
          const response = await api.create('sn_fin_supplier', {
            name,
            u_vendor: recordSysId
          });
          const newSysId = (response.result as any).sys_id;

          updateEntry(createLogId, {
            responseStatus: 201,
            responseBody: response,
            duration: Date.now() - startTime,
          });

          // Update vendor with new supplier reference
          await api.update('core_company', recordSysId, { supplier: newSysId });

          return newSysId;
        } catch (err: any) {
          updateEntry(createLogId, {
            responseStatus: err.response?.status || 500,
            error: err.message,
            duration: Date.now() - startTime,
          });
          throw err;
        }
      } else {
        // Create new vendor
        const createLogId = addEntry({
          method: 'POST',
          url: `${settings.servicenow.instanceUrl}/api/now/table/core_company`,
          table: 'core_company',
          headers: {
            'Content-Type': 'application/json',
            'x-sn-apikey': settings.servicenow.apiKey,
          },
          body: { name, vendor: 'true', supplier: recordSysId },
        });

        try {
          const response = await api.create('core_company', {
            name,
            vendor: 'true',
            supplier: recordSysId
          });
          const newSysId = (response.result as any).sys_id;

          updateEntry(createLogId, {
            responseStatus: 201,
            responseBody: response,
            duration: Date.now() - startTime,
          });

          // Update supplier with new vendor reference
          await api.update('sn_fin_supplier', recordSysId, { u_vendor: newSysId });

          return newSysId;
        } catch (err: any) {
          updateEntry(createLogId, {
            responseStatus: err.response?.status || 500,
            error: err.message,
            duration: Date.now() - startTime,
          });
          throw err;
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['table'] });
      onSuccess();
    },
  });

  const handleSelectRecord = (record: Record<string, unknown>) => {
    setSelectedRecord(record);
  };

  const handleLink = () => {
    if (selectedRecord) {
      linkMutation.mutate(getSysId(selectedRecord.sys_id));
    }
  };

  const handleCreateAndLink = () => {
    if (newRecordName) {
      createAndLinkMutation.mutate(newRecordName);
    }
  };

  const isProcessing = linkMutation.isPending || createAndLinkMutation.isPending;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-2xl w-[600px] max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-100 rounded-lg">
              <Link2 className="w-5 h-5 text-blue-600" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-gray-900">
                Link {targetLabel}
              </h2>
              <p className="text-sm text-gray-500">
                {mode === 'vendor' ? 'Vendor' : 'Supplier'}: {recordName}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Current Link Status */}
        {linkedSysId && (
          <div className="mx-4 mt-4 p-3 bg-green-50 border border-green-200 rounded-lg">
            <div className="flex items-center gap-2">
              <CheckCircle className="w-5 h-5 text-green-500" />
              <span className="text-sm text-green-700">
                Currently linked to: <strong>{linkedName || linkedSysId}</strong>
              </span>
            </div>
          </div>
        )}

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Search existing */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Search existing {targetLabel.toLowerCase()}s
            </label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={`Search by name...`}
                className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>

            {/* Search Results */}
            {isSearching ? (
              <div className="flex items-center justify-center py-4">
                <Loader2 className="w-5 h-5 text-blue-500 animate-spin" />
              </div>
            ) : searchResults && searchResults.length > 0 ? (
              <div className="mt-2 border border-gray-200 rounded-lg divide-y divide-gray-100 max-h-48 overflow-y-auto">
                {searchResults.map((record: Record<string, unknown>, index: number) => {
                  const recordSysId = getSysId(record.sys_id);
                  const isSelected = getSysId(selectedRecord?.sys_id) === recordSysId;
                  const recordName = getDisplayValue(record.name);
                  const recordCity = getDisplayValue(record.city);
                  return (
                    <button
                      key={recordSysId || `result-${index}`}
                      onClick={() => handleSelectRecord(record)}
                      className={clsx(
                        'w-full flex items-center gap-3 px-3 py-2 text-left transition-colors',
                        isSelected ? 'bg-blue-50' : 'hover:bg-gray-50'
                      )}
                    >
                      {isLinkingSupplier ? (
                        <Users className="w-4 h-4 text-gray-400" />
                      ) : (
                        <Building2 className="w-4 h-4 text-gray-400" />
                      )}
                      <div className="flex-1">
                        <span className="text-sm font-medium text-gray-900">
                          {recordName}
                        </span>
                        {recordCity && (
                          <span className="text-xs text-gray-500 ml-2">
                            {recordCity}
                          </span>
                        )}
                      </div>
                      {isSelected && (
                        <CheckCircle className="w-4 h-4 text-blue-500" />
                      )}
                    </button>
                  );
                })}
              </div>
            ) : searchQuery.length >= 2 ? (
              <p className="mt-2 text-sm text-gray-500">No results found</p>
            ) : null}
          </div>

          {/* Divider */}
          <div className="flex items-center gap-4">
            <div className="flex-1 border-t border-gray-200" />
            <span className="text-sm text-gray-500">or</span>
            <div className="flex-1 border-t border-gray-200" />
          </div>

          {/* Create new */}
          <div>
            <button
              onClick={() => setShowCreateForm(!showCreateForm)}
              className="flex items-center gap-2 text-sm text-blue-600 hover:text-blue-700"
            >
              <Plus className="w-4 h-4" />
              Create new {targetLabel.toLowerCase()}
            </button>

            {showCreateForm && (
              <div className="mt-3 p-3 bg-gray-50 rounded-lg space-y-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {targetLabel} Name
                  </label>
                  <input
                    type="text"
                    value={newRecordName}
                    onChange={(e) => setNewRecordName(e.target.value)}
                    placeholder={`Enter ${targetLabel.toLowerCase()} name`}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
                <div className="flex items-center gap-2 text-xs text-gray-500">
                  <AlertTriangle className="w-3 h-3" />
                  <span>The new {targetLabel.toLowerCase()} will be automatically linked</span>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 p-4 border-t border-gray-200 bg-gray-50">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg"
          >
            Cancel
          </button>

          {showCreateForm && newRecordName ? (
            <button
              onClick={handleCreateAndLink}
              disabled={isProcessing}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-green-600 hover:bg-green-700 rounded-lg disabled:opacity-50"
            >
              {isProcessing ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Creating...
                </>
              ) : (
                <>
                  <Plus className="w-4 h-4" />
                  Create & Link
                </>
              )}
            </button>
          ) : (
            <button
              onClick={handleLink}
              disabled={!selectedRecord || isProcessing}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-50"
            >
              {isProcessing ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Linking...
                </>
              ) : (
                <>
                  <Link2 className="w-4 h-4" />
                  Link {targetLabel}
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// Helper component for showing linked status in table views
export function LinkedStatusBadge({
  mode,
  linkedSysId,
  linkedName,
  onLinkClick,
}: {
  mode: 'vendor' | 'supplier';
  linkedSysId?: string;
  linkedName?: string;
  onLinkClick: () => void;
}) {
  if (linkedSysId) {
    return (
      <button
        onClick={(e) => {
          e.stopPropagation();
          onLinkClick();
        }}
        className="flex items-center gap-1 px-2 py-1 text-xs bg-green-100 text-green-700 rounded hover:bg-green-200"
      >
        <Link2 className="w-3 h-3" />
        {linkedName || 'Linked'}
      </button>
    );
  }

  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onLinkClick();
      }}
      className="flex items-center gap-1 px-2 py-1 text-xs bg-gray-100 text-gray-600 rounded hover:bg-gray-200"
    >
      <Plus className="w-3 h-3" />
      Link {mode === 'vendor' ? 'Supplier' : 'Vendor'}
    </button>
  );
}
