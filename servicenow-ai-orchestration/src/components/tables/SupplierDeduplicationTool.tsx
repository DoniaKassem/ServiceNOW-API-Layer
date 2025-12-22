import { useState, useCallback, useMemo } from 'react';
import {
  X,
  Search,
  Loader2,
  AlertTriangle,
  CheckCircle,
  Users,
  ArrowRight,
  Trash2,
  GitMerge,
  ShoppingCart,
  FileText,
  Info,
} from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { clsx } from 'clsx';
import { useSettingsStore } from '../../stores/settingsStore';
import { useRequestLogStore } from '../../stores/requestLogStore';
import { getServiceNowAPI, initServiceNowAPI } from '../../services/servicenow';
import { getSysId, getDisplayValue } from '../../utils/serviceNowHelpers';
import type { Supplier } from '../../types';

interface DuplicateSupplierGroup {
  id: string;
  suppliers: Supplier[];
  matchReason: string;
  affectedPOCount: number;
  masterSupplier?: Supplier;
}

interface MergeOperation {
  groupId: string;
  masterSysId: string;
  duplicateSysIds: string[];
  affectedPOs: Array<{ sys_id: string; display_name: string }>;
  status: 'pending' | 'merging' | 'success' | 'error';
  error?: string;
}

interface SupplierDeduplicationToolProps {
  onClose: () => void;
}

export function SupplierDeduplicationTool({ onClose }: SupplierDeduplicationToolProps) {
  const { settings } = useSettingsStore();
  const { addEntry, updateEntry } = useRequestLogStore();
  const queryClient = useQueryClient();

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedGroup, setSelectedGroup] = useState<DuplicateSupplierGroup | null>(null);
  const [mergeOperations, setMergeOperations] = useState<MergeOperation[]>([]);
  const [scanComplete, setScanComplete] = useState(false);

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

  // Fetch all suppliers
  const { data: suppliers, isLoading: isLoadingSuppliers } = useQuery({
    queryKey: ['all-suppliers-dedup'],
    queryFn: async () => {
      const api = getApi();
      const response = await api.get<Supplier>('sn_fin_supplier', {
        sysparm_limit: 1000,
        sysparm_display_value: 'all',
        sysparm_fields: 'sys_id,name,legal_name,u_vendor,web_site,street,city,state,country',
      });
      return response.result || [];
    },
    enabled: !!settings.servicenow.apiKey,
  });

  // Identify duplicate groups using multiple matching strategies
  const duplicateGroups = useMemo(() => {
    if (!suppliers || suppliers.length === 0) return [];

    const groups: DuplicateSupplierGroup[] = [];
    const processed = new Set<string>();

    suppliers.forEach((supplier, index) => {
      const supplierSysId = getSysId(supplier.sys_id);
      if (processed.has(supplierSysId)) return;

      const supplierName = getDisplayValue(supplier.name)?.toLowerCase().trim();
      const supplierLegalName = getDisplayValue(supplier.legal_name)?.toLowerCase().trim();
      const supplierVendor = getSysId((supplier.u_vendor as any)?.value || supplier.u_vendor);

      if (!supplierName || supplierName.length < 2) return;

      const duplicates: Supplier[] = [supplier];
      const reasons: string[] = [];

      // Check remaining suppliers for duplicates
      for (let i = index + 1; i < suppliers.length; i++) {
        const candidate = suppliers[i];
        const candidateSysId = getSysId(candidate.sys_id);
        
        if (processed.has(candidateSysId)) continue;

        const candidateName = getDisplayValue(candidate.name)?.toLowerCase().trim();
        const candidateLegalName = getDisplayValue(candidate.legal_name)?.toLowerCase().trim();
        const candidateVendor = getSysId((candidate.u_vendor as any)?.value || candidate.u_vendor);

        let isDuplicate = false;
        const matchReasons: string[] = [];

        // Exact name match
        if (candidateName === supplierName) {
          isDuplicate = true;
          matchReasons.push('exact name match');
        }

        // Legal name match
        if (supplierLegalName && candidateLegalName && supplierLegalName === candidateLegalName) {
          isDuplicate = true;
          matchReasons.push('legal name match');
        }

        // Same vendor reference
        if (supplierVendor && candidateVendor && supplierVendor === candidateVendor) {
          // If same vendor, check for similar names
          if (candidateName && supplierName && 
              (candidateName.includes(supplierName) || supplierName.includes(candidateName))) {
            isDuplicate = true;
            matchReasons.push('same vendor with similar name');
          }
        }

        // Fuzzy name matching (very similar names)
        if (candidateName && supplierName) {
          const similarity = calculateSimilarity(supplierName, candidateName);
          if (similarity > 0.85) {
            isDuplicate = true;
            matchReasons.push(`${Math.round(similarity * 100)}% name similarity`);
          }
        }

        if (isDuplicate) {
          duplicates.push(candidate);
          reasons.push(...matchReasons);
          processed.add(candidateSysId);
        }
      }

      if (duplicates.length > 1) {
        processed.add(supplierSysId);
        groups.push({
          id: `group-${supplierSysId}`,
          suppliers: duplicates,
          matchReason: Array.from(new Set(reasons)).join(', '),
          affectedPOCount: 0, // Will be populated later
        });
      }
    });

    return groups;
  }, [suppliers]);

  // Fetch PO counts for each duplicate group
  const { data: poCountsData } = useQuery({
    queryKey: ['po-counts', duplicateGroups.map(g => g.id).join(',')],
    queryFn: async () => {
      const api = getApi();
      const counts: Record<string, number> = {};

      for (const group of duplicateGroups) {
        const supplierSysIds = group.suppliers.map(s => getSysId(s.sys_id));
        const query = supplierSysIds.map(id => `supplier=${id}`).join('^OR');

        try {
          const response = await api.get<Record<string, unknown>>('sn_shop_purchase_order', {
            sysparm_query: query,
            sysparm_fields: 'sys_id',
            sysparm_limit: 1000,
          });
          counts[group.id] = response.result?.length || 0;
        } catch (err) {
          console.error(`Error fetching PO count for group ${group.id}:`, err);
          counts[group.id] = 0;
        }
      }

      return counts;
    },
    enabled: duplicateGroups.length > 0 && !!settings.servicenow.apiKey,
  });

  // Update groups with PO counts
  const groupsWithCounts = useMemo(() => {
    if (!poCountsData) return duplicateGroups;
    return duplicateGroups.map(group => ({
      ...group,
      affectedPOCount: poCountsData[group.id] || 0,
    }));
  }, [duplicateGroups, poCountsData]);

  // Filter groups by search query
  const filteredGroups = useMemo(() => {
    if (!searchQuery) return groupsWithCounts;
    const query = searchQuery.toLowerCase();
    return groupsWithCounts.filter(group =>
      group.suppliers.some(s =>
        getDisplayValue(s.name)?.toLowerCase().includes(query) ||
        getDisplayValue(s.legal_name)?.toLowerCase().includes(query)
      )
    );
  }, [groupsWithCounts, searchQuery]);

  // Fetch POs for selected group
  const { data: affectedPOs } = useQuery({
    queryKey: ['affected-pos', selectedGroup?.id],
    queryFn: async () => {
      if (!selectedGroup) return [];
      const api = getApi();
      const supplierSysIds = selectedGroup.suppliers.map(s => getSysId(s.sys_id));
      const query = supplierSysIds.map(id => `supplier=${id}`).join('^OR');

      const response = await api.get<Record<string, unknown>>('sn_shop_purchase_order', {
        sysparm_query: query,
        sysparm_fields: 'sys_id,display_name,number,supplier,total_amount,status',
        sysparm_display_value: 'all',
        sysparm_limit: 1000,
      });

      return response.result || [];
    },
    enabled: !!selectedGroup && !!settings.servicenow.apiKey,
  });

  // Merge mutation
  const mergeMutation = useMutation({
    mutationFn: async (operation: MergeOperation) => {
      const api = getApi();
      const results: Array<{ sysId: string; success: boolean; error?: string }> = [];

      // Update all POs to reference the master supplier
      for (const po of operation.affectedPOs) {
        const startTime = Date.now();
        const logId = addEntry({
          method: 'PATCH',
          url: `${settings.servicenow.instanceUrl}/api/now/table/sn_shop_purchase_order/${po.sys_id}`,
          table: 'sn_shop_purchase_order',
          recordSysId: po.sys_id,
          headers: {
            'Content-Type': 'application/json',
            'x-sn-apikey': settings.servicenow.apiKey,
          },
          body: { supplier: operation.masterSysId },
        });

        try {
          await api.update('sn_shop_purchase_order', po.sys_id, {
            supplier: operation.masterSysId,
          });

          updateEntry(logId, {
            responseStatus: 200,
            duration: Date.now() - startTime,
          });

          results.push({ sysId: po.sys_id, success: true });
        } catch (err: any) {
          updateEntry(logId, {
            responseStatus: err.response?.status || 500,
            error: err.message,
            duration: Date.now() - startTime,
          });

          results.push({ sysId: po.sys_id, success: false, error: err.message });
        }
      }

      // Delete duplicate suppliers (permanent removal)
      for (const dupSysId of operation.duplicateSysIds) {
        const startTime = Date.now();
        const logId = addEntry({
          method: 'DELETE',
          url: `${settings.servicenow.instanceUrl}/api/now/table/sn_fin_supplier/${dupSysId}`,
          table: 'sn_fin_supplier',
          recordSysId: dupSysId,
          headers: {
            'Content-Type': 'application/json',
            'x-sn-apikey': settings.servicenow.apiKey,
          },
        });

        try {
          await api.delete('sn_fin_supplier', dupSysId);

          updateEntry(logId, {
            responseStatus: 204,
            responseBody: { message: 'Supplier deleted successfully' },
            duration: Date.now() - startTime,
          });
        } catch (err: any) {
          updateEntry(logId, {
            responseStatus: err.response?.status || 500,
            error: err.message,
            duration: Date.now() - startTime,
          });
        }
      }

      return results;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['all-suppliers-dedup'] });
      queryClient.invalidateQueries({ queryKey: ['table'] });
    },
  });

  const handleSelectMaster = (group: DuplicateSupplierGroup, masterSupplier: Supplier) => {
    setSelectedGroup({
      ...group,
      masterSupplier,
    });
  };

  const handleMerge = async () => {
    if (!selectedGroup || !selectedGroup.masterSupplier || !affectedPOs) return;

    const masterSysId = getSysId(selectedGroup.masterSupplier.sys_id);
    const duplicateSysIds = selectedGroup.suppliers
      .filter(s => getSysId(s.sys_id) !== masterSysId)
      .map(s => getSysId(s.sys_id));

    const operation: MergeOperation = {
      groupId: selectedGroup.id,
      masterSysId,
      duplicateSysIds,
      affectedPOs: affectedPOs.map(po => ({
        sys_id: getSysId(po.sys_id),
        display_name: getDisplayValue(po.display_name) || getDisplayValue(po.number) || 'Unknown',
      })),
      status: 'merging',
    };

    setMergeOperations(prev => [...prev, operation]);

    try {
      await mergeMutation.mutateAsync(operation);
      setMergeOperations(prev =>
        prev.map(op =>
          op.groupId === operation.groupId ? { ...op, status: 'success' as const } : op
        )
      );
      setSelectedGroup(null);
    } catch (err: any) {
      setMergeOperations(prev =>
        prev.map(op =>
          op.groupId === operation.groupId
            ? { ...op, status: 'error' as const, error: err.message }
            : op
        )
      );
    }
  };

  const handleScan = () => {
    setScanComplete(true);
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-2xl w-[900px] max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-purple-100 rounded-lg">
              <GitMerge className="w-5 h-5 text-purple-600" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Supplier Deduplication Tool</h2>
              <p className="text-sm text-gray-500">
                Identify and merge duplicate supplier records
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

        {/* Content */}
        <div className="flex-1 overflow-hidden flex">
          {/* Left Panel - Duplicate Groups */}
          <div className="w-1/2 border-r border-gray-200 flex flex-col">
            <div className="p-4 border-b border-gray-200 space-y-3">
              {/* Search */}
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search suppliers..."
                  className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                />
              </div>

              {/* Scan Button */}
              {!scanComplete && (
                <button
                  onClick={handleScan}
                  disabled={isLoadingSuppliers}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium text-white bg-purple-600 hover:bg-purple-700 rounded-lg disabled:opacity-50"
                >
                  {isLoadingSuppliers ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Loading suppliers...
                    </>
                  ) : (
                    <>
                      <Search className="w-4 h-4" />
                      Scan for Duplicates
                    </>
                  )}
                </button>
              )}

              {/* Stats */}
              {scanComplete && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-600">
                    {filteredGroups.length} duplicate {filteredGroups.length === 1 ? 'group' : 'groups'} found
                  </span>
                  <span className="text-gray-500">
                    {suppliers?.length || 0} total suppliers
                  </span>
                </div>
              )}
            </div>

            {/* Groups List */}
            <div className="flex-1 overflow-y-auto p-4 space-y-2">
              {!scanComplete ? (
                <div className="flex flex-col items-center justify-center h-full text-center">
                  <Users className="w-12 h-12 text-gray-300 mb-3" />
                  <p className="text-sm text-gray-600">Click "Scan for Duplicates" to begin</p>
                  <p className="text-xs text-gray-500 mt-1">
                    The system will analyze all suppliers and identify potential duplicates
                  </p>
                </div>
              ) : filteredGroups.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-center">
                  <CheckCircle className="w-12 h-12 text-green-500 mb-3" />
                  <p className="text-sm text-gray-600 font-medium">No duplicates found!</p>
                  <p className="text-xs text-gray-500 mt-1">
                    All supplier records appear to be unique
                  </p>
                </div>
              ) : (
                filteredGroups.map((group) => (
                  <button
                    key={group.id}
                    onClick={() => setSelectedGroup(group)}
                    className={clsx(
                      'w-full p-3 border rounded-lg text-left transition-all',
                      selectedGroup?.id === group.id
                        ? 'border-purple-300 bg-purple-50'
                        : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                    )}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <p className="text-sm font-medium text-gray-900">
                          {group.suppliers.length} duplicate suppliers
                        </p>
                        <p className="text-xs text-gray-500 mt-1">{group.matchReason}</p>
                        <div className="flex items-center gap-3 mt-2 text-xs text-gray-600">
                          <span className="flex items-center gap-1">
                            <ShoppingCart className="w-3 h-3" />
                            {group.affectedPOCount} POs
                          </span>
                        </div>
                      </div>
                      <span className="px-2 py-1 text-xs bg-orange-100 text-orange-700 rounded">
                        {group.suppliers.length}x
                      </span>
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>

          {/* Right Panel - Details & Merge */}
          <div className="w-1/2 flex flex-col">
            {!selectedGroup ? (
              <div className="flex-1 flex items-center justify-center p-4">
                <div className="text-center">
                  <Info className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                  <p className="text-sm text-gray-600">Select a duplicate group to view details</p>
                </div>
              </div>
            ) : (
              <>
                <div className="p-4 border-b border-gray-200">
                  <h3 className="text-sm font-semibold text-gray-900 mb-2">
                    Duplicate Suppliers ({selectedGroup.suppliers.length})
                  </h3>
                  <p className="text-xs text-gray-500">
                    Select the master record to keep. Other records will be permanently deleted.
                  </p>
                </div>

                <div className="flex-1 overflow-y-auto p-4 space-y-3">
                  {selectedGroup.suppliers.map((supplier) => {
                    const sysId = getSysId(supplier.sys_id);
                    const isMaster = selectedGroup.masterSupplier && getSysId(selectedGroup.masterSupplier.sys_id) === sysId;
                    const poCount = affectedPOs?.filter(
                      po => getSysId((po.supplier as any)?.value || po.supplier) === sysId
                    ).length || 0;

                    return (
                      <div
                        key={sysId}
                        className={clsx(
                          'p-3 border rounded-lg',
                          isMaster
                            ? 'border-green-300 bg-green-50'
                            : 'border-gray-200 hover:border-gray-300'
                        )}
                      >
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <p className="text-sm font-medium text-gray-900">
                              {getDisplayValue(supplier.name)}
                            </p>
                            {supplier.legal_name && (
                              <p className="text-xs text-gray-500 mt-1">
                                Legal: {getDisplayValue(supplier.legal_name)}
                              </p>
                            )}
                            <div className="flex items-center gap-2 mt-2 text-xs text-gray-600">
                              <span className="flex items-center gap-1">
                                <ShoppingCart className="w-3 h-3" />
                                {poCount} POs
                              </span>
                              {supplier.city && (
                                <span>• {getDisplayValue(supplier.city)}</span>
                              )}
                            </div>
                          </div>
                          <button
                            onClick={() => handleSelectMaster(selectedGroup, supplier)}
                            className={clsx(
                              'px-3 py-1 text-xs font-medium rounded',
                              isMaster
                                ? 'bg-green-600 text-white'
                                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                            )}
                          >
                            {isMaster ? 'Master' : 'Set as Master'}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Footer */}
                <div className="p-4 border-t border-gray-200 bg-gray-50 space-y-3">
                  {selectedGroup.masterSupplier && (
                    <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
                      <div className="flex items-start gap-2">
                        <Info className="w-4 h-4 text-blue-600 flex-shrink-0 mt-0.5" />
                        <div className="text-xs text-blue-700">
                          <p className="font-medium mb-1">Merge Operation:</p>
                          <ul className="list-disc list-inside space-y-0.5">
                            <li>All {selectedGroup.affectedPOCount} POs will reference the master supplier</li>
                            <li>{selectedGroup.suppliers.length - 1} duplicate supplier(s) will be permanently deleted</li>
                            <li>All PO transaction history will be preserved</li>
                            <li>Complete audit trail will be maintained</li>
                          </ul>
                        </div>
                      </div>
                    </div>
                  )}

                  <button
                    onClick={handleMerge}
                    disabled={!selectedGroup.masterSupplier || mergeMutation.isPending}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium text-white bg-purple-600 hover:bg-purple-700 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {mergeMutation.isPending ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Merging...
                      </>
                    ) : (
                      <>
                        <GitMerge className="w-4 h-4" />
                        Merge Duplicates
                      </>
                    )}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Merge Operations Log */}
        {mergeOperations.length > 0 && (
          <div className="border-t border-gray-200 p-4 bg-gray-50 max-h-32 overflow-y-auto">
            <h4 className="text-xs font-semibold text-gray-700 mb-2">Recent Operations</h4>
            <div className="space-y-1">
              {mergeOperations.map((op, idx) => (
                <div key={idx} className="flex items-center gap-2 text-xs">
                  {op.status === 'success' ? (
                    <CheckCircle className="w-3 h-3 text-green-500" />
                  ) : op.status === 'error' ? (
                    <AlertTriangle className="w-3 h-3 text-red-500" />
                  ) : (
                    <Loader2 className="w-3 h-3 text-blue-500 animate-spin" />
                  )}
                  <span className="text-gray-600">
                    {op.affectedPOs.length} POs updated, {op.duplicateSysIds.length} duplicates removed
                  </span>
                  {op.error && <span className="text-red-600">({op.error})</span>}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// Simple string similarity calculation (Levenshtein-based)
function calculateSimilarity(str1: string, str2: string): number {
  const len1 = str1.length;
  const len2 = str2.length;
  const matrix: number[][] = [];

  for (let i = 0; i <= len1; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= len2; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= len1; i++) {
    for (let j = 1; j <= len2; j++) {
      const cost = str1[i - 1] === str2[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }

  const maxLen = Math.max(len1, len2);
  return 1 - matrix[len1][len2] / maxLen;
}