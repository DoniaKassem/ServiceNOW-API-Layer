import { useState, useCallback, useMemo } from 'react';
import {
  X,
  Search,
  Loader2,
  AlertTriangle,
  CheckCircle,
  Building2,
  ArrowRight,
  Trash2,
  GitMerge,
  FileText,
  Info,
} from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { clsx } from 'clsx';
import { useSettingsStore } from '../../stores/settingsStore';
import { useRequestLogStore } from '../../stores/requestLogStore';
import { getServiceNowAPI, initServiceNowAPI } from '../../services/servicenow';
import { getSysId, getDisplayValue } from '../../utils/serviceNowHelpers';
import type { Vendor } from '../../types';

interface DuplicateVendorGroup {
  id: string;
  vendors: Vendor[];
  matchReason: string;
  affectedContractCount: number;
  affectedSupplierCount: number;
  masterVendor?: Vendor;
}

interface MergeOperation {
  groupId: string;
  masterSysId: string;
  duplicateSysIds: string[];
  affectedContracts: Array<{ sys_id: string; display_name: string }>;
  affectedSuppliers: Array<{ sys_id: string; display_name: string }>;
  status: 'pending' | 'merging' | 'success' | 'error';
  error?: string;
}

interface VendorDeduplicationToolProps {
  onClose: () => void;
}

export function VendorDeduplicationTool({ onClose }: VendorDeduplicationToolProps) {
  const { settings } = useSettingsStore();
  const { addEntry, updateEntry } = useRequestLogStore();
  const queryClient = useQueryClient();

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedGroup, setSelectedGroup] = useState<DuplicateVendorGroup | null>(null);
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

  // Fetch all vendors
  const { data: vendors, isLoading: isLoadingVendors } = useQuery({
    queryKey: ['all-vendors-dedup'],
    queryFn: async () => {
      const api = getApi();
      const response = await api.get<Vendor>('core_company', {
        sysparm_query: 'vendor=true',
        sysparm_limit: 1000,
        sysparm_display_value: 'all',
        sysparm_fields: 'sys_id,name,status,website,street,city,state,country,vendor_type,supplier',
      });
      return response.result || [];
    },
    enabled: !!settings.servicenow.apiKey,
  });

  // Identify duplicate groups using multiple matching strategies
  const duplicateGroups = useMemo(() => {
    if (!vendors || vendors.length === 0) return [];

    const groups: DuplicateVendorGroup[] = [];
    const processed = new Set<string>();

    vendors.forEach((vendor, index) => {
      const vendorSysId = getSysId(vendor.sys_id);
      if (processed.has(vendorSysId)) return;

      const vendorName = getDisplayValue(vendor.name)?.toLowerCase().trim();
      const vendorWebsite = getDisplayValue(vendor.website)?.toLowerCase().trim();
      const vendorSupplier = getSysId((vendor.supplier as any)?.value || vendor.supplier);

      if (!vendorName || vendorName.length < 2) return;

      const duplicates: Vendor[] = [vendor];
      const reasons: string[] = [];

      // Check remaining vendors for duplicates
      for (let i = index + 1; i < vendors.length; i++) {
        const candidate = vendors[i];
        const candidateSysId = getSysId(candidate.sys_id);
        
        if (processed.has(candidateSysId)) continue;

        const candidateName = getDisplayValue(candidate.name)?.toLowerCase().trim();
        const candidateWebsite = getDisplayValue(candidate.website)?.toLowerCase().trim();
        const candidateSupplier = getSysId((candidate.supplier as any)?.value || candidate.supplier);

        let isDuplicate = false;
        const matchReasons: string[] = [];

        // Exact name match
        if (candidateName === vendorName) {
          isDuplicate = true;
          matchReasons.push('exact name match');
        }

        // Website match
        if (vendorWebsite && candidateWebsite && vendorWebsite === candidateWebsite) {
          isDuplicate = true;
          matchReasons.push('same website');
        }

        // Same supplier reference
        if (vendorSupplier && candidateSupplier && vendorSupplier === candidateSupplier) {
          isDuplicate = true;
          matchReasons.push('same linked supplier');
        }

        // Fuzzy name matching (very similar names)
        if (candidateName && vendorName) {
          const similarity = calculateSimilarity(vendorName, candidateName);
          if (similarity > 0.85) {
            isDuplicate = true;
            matchReasons.push(`${Math.round(similarity * 100)}% name similarity`);
          }
        }

        // Same address (city + state + country)
        const vendorCity = getDisplayValue(vendor.city)?.toLowerCase().trim();
        const vendorState = getDisplayValue(vendor.state)?.toLowerCase().trim();
        const vendorCountry = getDisplayValue(vendor.country)?.toLowerCase().trim();
        const candidateCity = getDisplayValue(candidate.city)?.toLowerCase().trim();
        const candidateState = getDisplayValue(candidate.state)?.toLowerCase().trim();
        const candidateCountry = getDisplayValue(candidate.country)?.toLowerCase().trim();

        if (vendorCity && candidateCity && vendorState && candidateState &&
            vendorCity === candidateCity && vendorState === candidateState) {
          // Check if names are somewhat similar
          if (candidateName && vendorName && 
              (candidateName.includes(vendorName.split(' ')[0]) || 
               vendorName.includes(candidateName.split(' ')[0]))) {
            isDuplicate = true;
            matchReasons.push('same location with similar name');
          }
        }

        if (isDuplicate) {
          duplicates.push(candidate);
          reasons.push(...matchReasons);
          processed.add(candidateSysId);
        }
      }

      if (duplicates.length > 1) {
        processed.add(vendorSysId);
        groups.push({
          id: `group-${vendorSysId}`,
          vendors: duplicates,
          matchReason: Array.from(new Set(reasons)).join(', '),
          affectedContractCount: 0, // Will be populated later
          affectedSupplierCount: 0, // Will be populated later
        });
      }
    });

    return groups;
  }, [vendors]);

  // Fetch contract and supplier counts for each duplicate group
  const { data: relatedCountsData } = useQuery({
    queryKey: ['vendor-related-counts', duplicateGroups.map(g => g.id).join(',')],
    queryFn: async () => {
      const api = getApi();
      const counts: Record<string, { contracts: number; suppliers: number }> = {};

      for (const group of duplicateGroups) {
        const vendorSysIds = group.vendors.map(v => getSysId(v.sys_id));
        const query = vendorSysIds.map(id => `vendor=${id}`).join('^OR');

        try {
          // Count contracts
          const contractsResponse = await api.get<Record<string, unknown>>('ast_contract', {
            sysparm_query: query,
            sysparm_fields: 'sys_id',
            sysparm_limit: 1000,
          });

          // Count suppliers
          const suppliersResponse = await api.get<Record<string, unknown>>('sn_fin_supplier', {
            sysparm_query: query.replace(/vendor=/g, 'u_vendor='),
            sysparm_fields: 'sys_id',
            sysparm_limit: 1000,
          });

          counts[group.id] = {
            contracts: contractsResponse.result?.length || 0,
            suppliers: suppliersResponse.result?.length || 0,
          };
        } catch (err) {
          console.error(`Error fetching counts for group ${group.id}:`, err);
          counts[group.id] = { contracts: 0, suppliers: 0 };
        }
      }

      return counts;
    },
    enabled: duplicateGroups.length > 0 && !!settings.servicenow.apiKey,
  });

  // Update groups with counts
  const groupsWithCounts = useMemo(() => {
    if (!relatedCountsData) return duplicateGroups;
    return duplicateGroups.map(group => ({
      ...group,
      affectedContractCount: relatedCountsData[group.id]?.contracts || 0,
      affectedSupplierCount: relatedCountsData[group.id]?.suppliers || 0,
    }));
  }, [duplicateGroups, relatedCountsData]);

  // Filter groups by search query
  const filteredGroups = useMemo(() => {
    if (!searchQuery) return groupsWithCounts;
    const query = searchQuery.toLowerCase();
    return groupsWithCounts.filter(group =>
      group.vendors.some(v =>
        getDisplayValue(v.name)?.toLowerCase().includes(query) ||
        getDisplayValue(v.website)?.toLowerCase().includes(query)
      )
    );
  }, [groupsWithCounts, searchQuery]);

  // Fetch contracts and suppliers for selected group
  const { data: affectedRecords } = useQuery({
    queryKey: ['affected-records', selectedGroup?.id],
    queryFn: async () => {
      if (!selectedGroup) return { contracts: [], suppliers: [] };
      const api = getApi();
      const vendorSysIds = selectedGroup.vendors.map(v => getSysId(v.sys_id));
      const vendorQuery = vendorSysIds.map(id => `vendor=${id}`).join('^OR');
      const supplierQuery = vendorSysIds.map(id => `u_vendor=${id}`).join('^OR');

      const [contractsResponse, suppliersResponse] = await Promise.all([
        api.get<Record<string, unknown>>('ast_contract', {
          sysparm_query: vendorQuery,
          sysparm_fields: 'sys_id,number,short_description,vendor,state',
          sysparm_display_value: 'all',
          sysparm_limit: 1000,
        }),
        api.get<Record<string, unknown>>('sn_fin_supplier', {
          sysparm_query: supplierQuery,
          sysparm_fields: 'sys_id,name,u_vendor',
          sysparm_display_value: 'all',
          sysparm_limit: 1000,
        }),
      ]);

      return {
        contracts: contractsResponse.result || [],
        suppliers: suppliersResponse.result || [],
      };
    },
    enabled: !!selectedGroup && !!settings.servicenow.apiKey,
  });

  // Merge mutation
  const mergeMutation = useMutation({
    mutationFn: async (operation: MergeOperation) => {
      const api = getApi();
      const results: Array<{ sysId: string; success: boolean; error?: string }> = [];

      // Update all contracts to reference the master vendor
      for (const contract of operation.affectedContracts) {
        const startTime = Date.now();
        const logId = addEntry({
          method: 'PATCH',
          url: `${settings.servicenow.instanceUrl}/api/now/table/ast_contract/${contract.sys_id}`,
          table: 'ast_contract',
          recordSysId: contract.sys_id,
          headers: {
            'Content-Type': 'application/json',
            'x-sn-apikey': settings.servicenow.apiKey,
          },
          body: { vendor: operation.masterSysId },
        });

        try {
          await api.update('ast_contract', contract.sys_id, {
            vendor: operation.masterSysId,
          });

          updateEntry(logId, {
            responseStatus: 200,
            duration: Date.now() - startTime,
          });

          results.push({ sysId: contract.sys_id, success: true });
        } catch (err: any) {
          updateEntry(logId, {
            responseStatus: err.response?.status || 500,
            error: err.message,
            duration: Date.now() - startTime,
          });

          results.push({ sysId: contract.sys_id, success: false, error: err.message });
        }
      }

      // Update all suppliers to reference the master vendor
      for (const supplier of operation.affectedSuppliers) {
        const startTime = Date.now();
        const logId = addEntry({
          method: 'PATCH',
          url: `${settings.servicenow.instanceUrl}/api/now/table/sn_fin_supplier/${supplier.sys_id}`,
          table: 'sn_fin_supplier',
          recordSysId: supplier.sys_id,
          headers: {
            'Content-Type': 'application/json',
            'x-sn-apikey': settings.servicenow.apiKey,
          },
          body: { u_vendor: operation.masterSysId },
        });

        try {
          await api.update('sn_fin_supplier', supplier.sys_id, {
            u_vendor: operation.masterSysId,
          });

          updateEntry(logId, {
            responseStatus: 200,
            duration: Date.now() - startTime,
          });

          results.push({ sysId: supplier.sys_id, success: true });
        } catch (err: any) {
          updateEntry(logId, {
            responseStatus: err.response?.status || 500,
            error: err.message,
            duration: Date.now() - startTime,
          });

          results.push({ sysId: supplier.sys_id, success: false, error: err.message });
        }
      }

      // Delete duplicate vendors (permanent removal)
      for (const dupSysId of operation.duplicateSysIds) {
        const startTime = Date.now();
        const logId = addEntry({
          method: 'DELETE',
          url: `${settings.servicenow.instanceUrl}/api/now/table/core_company/${dupSysId}`,
          table: 'core_company',
          recordSysId: dupSysId,
          headers: {
            'Content-Type': 'application/json',
            'x-sn-apikey': settings.servicenow.apiKey,
          },
        });

        try {
          await api.delete('core_company', dupSysId);

          updateEntry(logId, {
            responseStatus: 204,
            responseBody: { message: 'Vendor deleted successfully' },
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
      queryClient.invalidateQueries({ queryKey: ['all-vendors-dedup'] });
      queryClient.invalidateQueries({ queryKey: ['table'] });
    },
  });

  const handleSelectMaster = (group: DuplicateVendorGroup, masterVendor: Vendor) => {
    setSelectedGroup({
      ...group,
      masterVendor,
    });
  };

  const handleMerge = async () => {
    if (!selectedGroup || !selectedGroup.masterVendor || !affectedRecords) return;

    const masterSysId = getSysId(selectedGroup.masterVendor.sys_id);
    const duplicateSysIds = selectedGroup.vendors
      .filter(v => getSysId(v.sys_id) !== masterSysId)
      .map(v => getSysId(v.sys_id));

    const operation: MergeOperation = {
      groupId: selectedGroup.id,
      masterSysId,
      duplicateSysIds,
      affectedContracts: affectedRecords.contracts.map(c => ({
        sys_id: getSysId(c.sys_id),
        display_name: getDisplayValue(c.number) || getDisplayValue(c.short_description) || 'Unknown',
      })),
      affectedSuppliers: affectedRecords.suppliers.map(s => ({
        sys_id: getSysId(s.sys_id),
        display_name: getDisplayValue(s.name) || 'Unknown',
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
            <div className="p-2 bg-blue-100 rounded-lg">
              <GitMerge className="w-5 h-5 text-blue-600" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Vendor Deduplication Tool</h2>
              <p className="text-sm text-gray-500">
                Identify and merge duplicate vendor records
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
                  placeholder="Search vendors..."
                  className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>

              {/* Scan Button */}
              {!scanComplete && (
                <button
                  onClick={handleScan}
                  disabled={isLoadingVendors}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-50"
                >
                  {isLoadingVendors ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Loading vendors...
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
                    {vendors?.length || 0} total vendors
                  </span>
                </div>
              )}
            </div>

            {/* Groups List */}
            <div className="flex-1 overflow-y-auto p-4 space-y-2">
              {!scanComplete ? (
                <div className="flex flex-col items-center justify-center h-full text-center">
                  <Building2 className="w-12 h-12 text-gray-300 mb-3" />
                  <p className="text-sm text-gray-600">Click "Scan for Duplicates" to begin</p>
                  <p className="text-xs text-gray-500 mt-1">
                    The system will analyze all vendors and identify potential duplicates
                  </p>
                </div>
              ) : filteredGroups.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-center">
                  <CheckCircle className="w-12 h-12 text-green-500 mb-3" />
                  <p className="text-sm text-gray-600 font-medium">No duplicates found!</p>
                  <p className="text-xs text-gray-500 mt-1">
                    All vendor records appear to be unique
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
                        ? 'border-blue-300 bg-blue-50'
                        : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                    )}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <p className="text-sm font-medium text-gray-900">
                          {group.vendors.length} duplicate vendors
                        </p>
                        <p className="text-xs text-gray-500 mt-1">{group.matchReason}</p>
                        <div className="flex items-center gap-3 mt-2 text-xs text-gray-600">
                          <span className="flex items-center gap-1">
                            <FileText className="w-3 h-3" />
                            {group.affectedContractCount} contracts
                          </span>
                          <span className="flex items-center gap-1">
                            <Building2 className="w-3 h-3" />
                            {group.affectedSupplierCount} suppliers
                          </span>
                        </div>
                      </div>
                      <span className="px-2 py-1 text-xs bg-orange-100 text-orange-700 rounded">
                        {group.vendors.length}x
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
                    Duplicate Vendors ({selectedGroup.vendors.length})
                  </h3>
                  <p className="text-xs text-gray-500">
                    Select the master record to keep. Other records will be permanently deleted.
                  </p>
                </div>

                <div className="flex-1 overflow-y-auto p-4 space-y-3">
                  {selectedGroup.vendors.map((vendor) => {
                    const sysId = getSysId(vendor.sys_id);
                    const isMaster = selectedGroup.masterVendor && getSysId(selectedGroup.masterVendor.sys_id) === sysId;
                    const contractCount = affectedRecords?.contracts.filter(
                      c => getSysId((c.vendor as any)?.value || c.vendor) === sysId
                    ).length || 0;
                    const supplierCount = affectedRecords?.suppliers.filter(
                      s => getSysId((s.u_vendor as any)?.value || s.u_vendor) === sysId
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
                              {getDisplayValue(vendor.name)}
                            </p>
                            {vendor.website && (
                              <p className="text-xs text-gray-500 mt-1">
                                Website: {getDisplayValue(vendor.website)}
                              </p>
                            )}
                            {vendor.vendor_type && (
                              <p className="text-xs text-gray-500">
                                Type: {getDisplayValue(vendor.vendor_type)}
                              </p>
                            )}
                            <div className="flex items-center gap-2 mt-2 text-xs text-gray-600">
                              <span className="flex items-center gap-1">
                                <FileText className="w-3 h-3" />
                                {contractCount} contracts
                              </span>
                              <span className="flex items-center gap-1">
                                <Building2 className="w-3 h-3" />
                                {supplierCount} suppliers
                              </span>
                              {vendor.city && (
                                <span>• {getDisplayValue(vendor.city)}</span>
                              )}
                            </div>
                          </div>
                          <button
                            onClick={() => handleSelectMaster(selectedGroup, vendor)}
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
                  {selectedGroup.masterVendor && (
                    <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
                      <div className="flex items-start gap-2">
                        <Info className="w-4 h-4 text-blue-600 flex-shrink-0 mt-0.5" />
                        <div className="text-xs text-blue-700">
                          <p className="font-medium mb-1">Merge Operation:</p>
                          <ul className="list-disc list-inside space-y-0.5">
                            <li>All {selectedGroup.affectedContractCount} contracts will reference the master vendor</li>
                            <li>All {selectedGroup.affectedSupplierCount} suppliers will reference the master vendor</li>
                            <li>{selectedGroup.vendors.length - 1} duplicate vendor(s) will be permanently deleted</li>
                            <li>All transaction history will be preserved</li>
                            <li>Complete audit trail will be maintained</li>
                          </ul>
                        </div>
                      </div>
                    </div>
                  )}

                  <button
                    onClick={handleMerge}
                    disabled={!selectedGroup.masterVendor || mergeMutation.isPending}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
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
                    {op.affectedContracts.length} contracts + {op.affectedSuppliers.length} suppliers updated, {op.duplicateSysIds.length} duplicates removed
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