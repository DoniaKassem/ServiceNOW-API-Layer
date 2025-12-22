import { useState, useCallback } from 'react';
import {
  X,
  Tag,
  Search,
  Loader2,
  Plus,
  CheckCircle,
  Server,
  Package,
  Box,
} from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { clsx } from 'clsx';
import { useSettingsStore } from '../../stores/settingsStore';
import { useRequestLogStore } from '../../stores/requestLogStore';
import { getServiceNowAPI, initServiceNowAPI } from '../../services/servicenow';
import { getSysId, getDisplayValue } from '../../utils/serviceNowHelpers';
import type { ClassificationType } from '../../types';

interface ExpenseLineClassificationProps {
  expenseLineId: string;
  contractId: string;
  vendorId?: string;
  currentClassification?: ClassificationType;
  currentLinkedId?: string;
  currentLinkedName?: string;
  onClose: () => void;
  onSuccess: () => void;
}

export function ExpenseLineClassification({
  expenseLineId,
  contractId,
  vendorId,
  currentClassification = 'none',
  currentLinkedId,
  currentLinkedName,
  onClose,
  onSuccess,
}: ExpenseLineClassificationProps) {
  const { settings } = useSettingsStore();
  const { addEntry, updateEntry } = useRequestLogStore();
  const queryClient = useQueryClient();

  const [classificationType, setClassificationType] = useState<ClassificationType>(currentClassification);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedRecord, setSelectedRecord] = useState<Record<string, unknown> | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newRecordName, setNewRecordName] = useState('');
  const [newRecordDescription, setNewRecordDescription] = useState('');

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

  // Get the table for the selected classification type
  const getTableForType = (type: ClassificationType): string | null => {
    switch (type) {
      case 'configuration_item':
        return 'cmdb_ci';
      case 'offering':
        return 'service_offering';
      case 'asset':
        return 'alm_asset';
      default:
        return null;
    }
  };

  // Search for records
  const { data: searchResults, isLoading: isSearching } = useQuery({
    queryKey: ['classification-search', classificationType, searchQuery, vendorId],
    queryFn: async () => {
      if (!searchQuery || searchQuery.length < 2) return [];

      const api = getApi();
      const table = getTableForType(classificationType);
      if (!table) return [];

      let query = `nameLIKE${searchQuery}^ORshort_descriptionLIKE${searchQuery}`;

      // For offerings, filter by vendor if available
      if (classificationType === 'offering' && vendorId) {
        query = `vendor=${vendorId}^${query}`;
      }

      const response = await api.get<Record<string, unknown>>(table, {
        sysparm_query: query,
        sysparm_limit: 10,
        sysparm_display_value: 'all',
      });

      return response.result || [];
    },
    enabled: classificationType !== 'none' && searchQuery.length >= 2 && !!settings.servicenow.apiKey,
  });

  // Classification mutation
  const classifyMutation = useMutation({
    mutationFn: async () => {
      const api = getApi();
      const startTime = Date.now();

      if (classificationType === 'none') {
        // Clear classification
        const logId = addEntry({
          method: 'PATCH',
          url: `${settings.servicenow.instanceUrl}/api/now/table/fm_expense_line/${expenseLineId}`,
          table: 'fm_expense_line',
          recordSysId: expenseLineId,
          headers: {
            'Content-Type': 'application/json',
            'x-sn-apikey': settings.servicenow.apiKey,
          },
          body: { ci: '' },
        });

        try {
          await api.update('fm_expense_line', expenseLineId, { ci: '' });
          updateEntry(logId, {
            responseStatus: 200,
            duration: Date.now() - startTime,
          });
        } catch (err: any) {
          updateEntry(logId, {
            responseStatus: err.response?.status || 500,
            error: err.message,
            duration: Date.now() - startTime,
          });
          throw err;
        }
        return;
      }

      if (!selectedRecord) {
        throw new Error('No record selected');
      }

      const linkedSysId = getSysId(selectedRecord.sys_id);

      if (classificationType === 'configuration_item') {
        // Update expense line with CI reference
        const logId = addEntry({
          method: 'PATCH',
          url: `${settings.servicenow.instanceUrl}/api/now/table/fm_expense_line/${expenseLineId}`,
          table: 'fm_expense_line',
          recordSysId: expenseLineId,
          headers: {
            'Content-Type': 'application/json',
            'x-sn-apikey': settings.servicenow.apiKey,
          },
          body: { ci: linkedSysId },
        });

        try {
          await api.update('fm_expense_line', expenseLineId, { ci: linkedSysId });
          updateEntry(logId, {
            responseStatus: 200,
            duration: Date.now() - startTime,
          });
        } catch (err: any) {
          updateEntry(logId, {
            responseStatus: err.response?.status || 500,
            error: err.message,
            duration: Date.now() - startTime,
          });
          throw err;
        }
      } else if (classificationType === 'asset') {
        // Create contract-asset relationship
        const logId = addEntry({
          method: 'POST',
          url: `${settings.servicenow.instanceUrl}/api/now/table/clm_m2m_contract_asset`,
          table: 'clm_m2m_contract_asset',
          headers: {
            'Content-Type': 'application/json',
            'x-sn-apikey': settings.servicenow.apiKey,
          },
          body: { contract: contractId, asset: linkedSysId },
        });

        try {
          await api.create('clm_m2m_contract_asset', {
            contract: contractId,
            asset: linkedSysId,
          });
          updateEntry(logId, {
            responseStatus: 201,
            duration: Date.now() - startTime,
          });
        } catch (err: any) {
          updateEntry(logId, {
            responseStatus: err.response?.status || 500,
            error: err.message,
            duration: Date.now() - startTime,
          });
          throw err;
        }
      }
      // For offerings, no additional linking needed - just reference
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['table'] });
      onSuccess();
    },
  });

  // Create and classify mutation
  const createAndClassifyMutation = useMutation({
    mutationFn: async () => {
      const api = getApi();
      const startTime = Date.now();

      let newSysId: string;

      if (classificationType === 'configuration_item') {
        const logId = addEntry({
          method: 'POST',
          url: `${settings.servicenow.instanceUrl}/api/now/table/cmdb_ci`,
          table: 'cmdb_ci',
          headers: {
            'Content-Type': 'application/json',
            'x-sn-apikey': settings.servicenow.apiKey,
          },
          body: { name: newRecordName, short_description: newRecordDescription },
        });

        try {
          const response = await api.create('cmdb_ci', {
            name: newRecordName,
            short_description: newRecordDescription,
          });
          newSysId = (response.result as any).sys_id;
          updateEntry(logId, {
            responseStatus: 201,
            responseBody: response,
            duration: Date.now() - startTime,
          });
        } catch (err: any) {
          updateEntry(logId, {
            responseStatus: err.response?.status || 500,
            error: err.message,
            duration: Date.now() - startTime,
          });
          throw err;
        }

        // Update expense line with CI
        await api.update('fm_expense_line', expenseLineId, { ci: newSysId });

      } else if (classificationType === 'offering') {
        const logId = addEntry({
          method: 'POST',
          url: `${settings.servicenow.instanceUrl}/api/now/table/service_offering`,
          table: 'service_offering',
          headers: {
            'Content-Type': 'application/json',
            'x-sn-apikey': settings.servicenow.apiKey,
          },
          body: { name: newRecordName, description: newRecordDescription, vendor: vendorId },
        });

        try {
          const response = await api.create('service_offering', {
            name: newRecordName,
            description: newRecordDescription,
            vendor: vendorId,
          });
          newSysId = (response.result as any).sys_id;
          updateEntry(logId, {
            responseStatus: 201,
            responseBody: response,
            duration: Date.now() - startTime,
          });
        } catch (err: any) {
          updateEntry(logId, {
            responseStatus: err.response?.status || 500,
            error: err.message,
            duration: Date.now() - startTime,
          });
          throw err;
        }

      } else if (classificationType === 'asset') {
        // For assets, we need a model first - this is simplified
        const logId = addEntry({
          method: 'POST',
          url: `${settings.servicenow.instanceUrl}/api/now/table/alm_asset`,
          table: 'alm_asset',
          headers: {
            'Content-Type': 'application/json',
            'x-sn-apikey': settings.servicenow.apiKey,
          },
          body: { display_name: newRecordName, short_description: newRecordDescription },
        });

        try {
          const response = await api.create('alm_asset', {
            display_name: newRecordName,
            short_description: newRecordDescription,
          });
          newSysId = (response.result as any).sys_id;
          updateEntry(logId, {
            responseStatus: 201,
            responseBody: response,
            duration: Date.now() - startTime,
          });

          // Create contract-asset relationship
          await api.create('clm_m2m_contract_asset', {
            contract: contractId,
            asset: newSysId,
          });
        } catch (err: any) {
          updateEntry(logId, {
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

  const handleClassify = () => {
    if (showCreateForm && newRecordName) {
      createAndClassifyMutation.mutate();
    } else {
      classifyMutation.mutate();
    }
  };

  const getClassificationIcon = (type: ClassificationType) => {
    switch (type) {
      case 'configuration_item':
        return <Server className="w-5 h-5" />;
      case 'offering':
        return <Package className="w-5 h-5" />;
      case 'asset':
        return <Box className="w-5 h-5" />;
      default:
        return <Tag className="w-5 h-5" />;
    }
  };

  const isProcessing = classifyMutation.isPending || createAndClassifyMutation.isPending;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-2xl w-[600px] max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-purple-100 rounded-lg">
              <Tag className="w-5 h-5 text-purple-600" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-gray-900">
                Classify Expense Line
              </h2>
              <p className="text-sm text-gray-500">
                Link to a CI, Offering, or Asset
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

        {/* Current Classification */}
        {currentLinkedId && (
          <div className="mx-4 mt-4 p-3 bg-purple-50 border border-purple-200 rounded-lg">
            <div className="flex items-center gap-2">
              <CheckCircle className="w-5 h-5 text-purple-500" />
              <span className="text-sm text-purple-700">
                Currently linked to: <strong>{currentLinkedName || currentLinkedId}</strong>
              </span>
            </div>
          </div>
        )}

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Classification Type Selection */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Classification Type
            </label>
            <div className="grid grid-cols-4 gap-2">
              {[
                { type: 'none' as ClassificationType, label: 'None', icon: Tag },
                { type: 'configuration_item' as ClassificationType, label: 'Config Item', icon: Server },
                { type: 'offering' as ClassificationType, label: 'Offering', icon: Package },
                { type: 'asset' as ClassificationType, label: 'Asset', icon: Box },
              ].map(({ type, label, icon: Icon }) => (
                <button
                  key={type}
                  onClick={() => {
                    setClassificationType(type);
                    setSelectedRecord(null);
                    setSearchQuery('');
                  }}
                  className={clsx(
                    'flex flex-col items-center gap-2 p-3 rounded-lg border transition-colors',
                    classificationType === type
                      ? 'border-purple-500 bg-purple-50 text-purple-700'
                      : 'border-gray-200 hover:bg-gray-50 text-gray-600'
                  )}
                >
                  <Icon className="w-5 h-5" />
                  <span className="text-xs font-medium">{label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Search / Create Section */}
          {classificationType !== 'none' && (
            <>
              {/* Search */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Search existing records
                </label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search by name..."
                    className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                  />
                </div>

                {/* Search Results */}
                {isSearching ? (
                  <div className="flex items-center justify-center py-4">
                    <Loader2 className="w-5 h-5 text-purple-500 animate-spin" />
                  </div>
                ) : searchResults && searchResults.length > 0 ? (
                  <div className="mt-2 border border-gray-200 rounded-lg divide-y divide-gray-100 max-h-48 overflow-y-auto">
                    {searchResults.map((record: Record<string, unknown>, index: number) => {
                      const recordSysId = getSysId(record.sys_id);
                      const isSelected = getSysId(selectedRecord?.sys_id) === recordSysId;
                      const recordName = getDisplayValue(record.name) || getDisplayValue(record.display_name);
                      const recordDescription = getDisplayValue(record.short_description);
                      return (
                        <button
                          key={recordSysId || `result-${index}`}
                          onClick={() => {
                            setSelectedRecord(record);
                            setShowCreateForm(false);
                          }}
                          className={clsx(
                            'w-full flex items-center gap-3 px-3 py-2 text-left transition-colors',
                            isSelected ? 'bg-purple-50' : 'hover:bg-gray-50'
                          )}
                        >
                          {getClassificationIcon(classificationType)}
                          <div className="flex-1">
                            <span className="text-sm font-medium text-gray-900">
                              {recordName}
                            </span>
                            {recordDescription && (
                              <span className="text-xs text-gray-500 block truncate">
                                {recordDescription}
                              </span>
                            )}
                          </div>
                          {isSelected && (
                            <CheckCircle className="w-4 h-4 text-purple-500" />
                          )}
                        </button>
                      );
                    })}
                  </div>
                ) : searchQuery.length >= 2 ? (
                  <p className="mt-2 text-sm text-gray-500">No results found</p>
                ) : null}
              </div>

              {/* Create New */}
              <div>
                <button
                  onClick={() => {
                    setShowCreateForm(!showCreateForm);
                    setSelectedRecord(null);
                  }}
                  className="flex items-center gap-2 text-sm text-purple-600 hover:text-purple-700"
                >
                  <Plus className="w-4 h-4" />
                  Create new {classificationType.replace('_', ' ')}
                </button>

                {showCreateForm && (
                  <div className="mt-3 p-3 bg-gray-50 rounded-lg space-y-3">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Name
                      </label>
                      <input
                        type="text"
                        value={newRecordName}
                        onChange={(e) => setNewRecordName(e.target.value)}
                        placeholder="Enter name"
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Description
                      </label>
                      <textarea
                        value={newRecordDescription}
                        onChange={(e) => setNewRecordDescription(e.target.value)}
                        placeholder="Enter description"
                        rows={2}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                      />
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 p-4 border-t border-gray-200 bg-gray-50">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg"
          >
            Cancel
          </button>
          <button
            onClick={handleClassify}
            disabled={
              isProcessing ||
              (classificationType !== 'none' && !selectedRecord && !showCreateForm) ||
              (showCreateForm && !newRecordName)
            }
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-purple-600 hover:bg-purple-700 rounded-lg disabled:opacity-50"
          >
            {isProcessing ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Processing...
              </>
            ) : (
              <>
                <Tag className="w-4 h-4" />
                {classificationType === 'none' ? 'Clear Classification' : 'Apply Classification'}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
