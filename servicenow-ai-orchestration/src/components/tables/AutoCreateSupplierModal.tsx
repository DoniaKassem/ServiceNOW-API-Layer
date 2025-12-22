import { useState, useMemo } from 'react';
import {
  X,
  AlertTriangle,
  Loader2,
  CheckCircle,
  Link2,
  Building2,
  ArrowRight,
  RefreshCw,
} from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { clsx } from 'clsx';
import { useSettingsStore } from '../../stores/settingsStore';
import { useRequestLogStore } from '../../stores/requestLogStore';
import { getServiceNowAPI, initServiceNowAPI } from '../../services/servicenow';
import { getSysId, getDisplayValue } from '../../utils/serviceNowHelpers';

interface ContractWithMissingSupplier {
  sys_id: string;
  number: string;
  short_description: string;
  vendor: {
    sys_id: string;
    name: string;
  };
  supplier: unknown; // Could be empty, placeholder, or object
}

interface AutoCreateSupplierModalProps {
  contracts: Record<string, unknown>[];
  onClose: () => void;
  onSuccess: () => void;
}

interface ProcessingResult {
  contractNumber: string;
  vendorName: string;
  status: 'pending' | 'creating_supplier' | 'linking_contract' | 'success' | 'error';
  error?: string;
  supplierSysId?: string;
}

export function AutoCreateSupplierModal({
  contracts,
  onClose,
  onSuccess,
}: AutoCreateSupplierModalProps) {
  const { settings } = useSettingsStore();
  const { addEntry, updateEntry } = useRequestLogStore();
  const queryClient = useQueryClient();

  const [isProcessing, setIsProcessing] = useState(false);
  const [results, setResults] = useState<ProcessingResult[]>([]);
  const [selectedContracts, setSelectedContracts] = useState<Set<string>>(() =>
    new Set(contracts.map(c => getSysId(c.sys_id)))
  );

  // Parse contracts with missing suppliers
  const contractsWithMissingSuppliers = useMemo(() => {
    return contracts
      .filter(contract => {
        const supplierValue = getDisplayValue(contract.supplier);
        // Check if supplier is missing or is a placeholder like "{{supplier.sys_id}}"
        return !supplierValue ||
               supplierValue.includes('{{') ||
               supplierValue === '-' ||
               supplierValue === '';
      })
      .map(contract => {
        const vendorField = contract.vendor as { display_value?: string; value?: string } | string;
        let vendorSysId = '';
        let vendorName = '';

        if (typeof vendorField === 'object' && vendorField !== null) {
          vendorSysId = vendorField.value || '';
          vendorName = vendorField.display_value || '';
        } else if (typeof vendorField === 'string') {
          vendorSysId = vendorField;
          vendorName = vendorField;
        }

        return {
          sys_id: getSysId(contract.sys_id),
          number: getDisplayValue(contract.number),
          short_description: getDisplayValue(contract.short_description),
          vendor: {
            sys_id: vendorSysId,
            name: vendorName,
          },
          supplier: contract.supplier,
        } as ContractWithMissingSupplier;
      })
      .filter(c => c.vendor.sys_id); // Only include contracts that have a vendor
  }, [contracts]);

  const toggleContract = (sysId: string) => {
    setSelectedContracts(prev => {
      const next = new Set(prev);
      if (next.has(sysId)) {
        next.delete(sysId);
      } else {
        next.add(sysId);
      }
      return next;
    });
  };

  const toggleAll = () => {
    if (selectedContracts.size === contractsWithMissingSuppliers.length) {
      setSelectedContracts(new Set());
    } else {
      setSelectedContracts(new Set(contractsWithMissingSuppliers.map(c => c.sys_id)));
    }
  };

  // Process contracts mutation
  const processMutation = useMutation({
    mutationFn: async () => {
      const api = (() => {
        try {
          return getServiceNowAPI(settings.servicenow.instanceUrl, settings.servicenow.apiKey);
        } catch {
          return initServiceNowAPI(settings.servicenow.instanceUrl, settings.servicenow.apiKey);
        }
      })();

      const selectedList = contractsWithMissingSuppliers.filter(c =>
        selectedContracts.has(c.sys_id)
      );

      // Initialize results
      const initialResults: ProcessingResult[] = selectedList.map(c => ({
        contractNumber: c.number,
        vendorName: c.vendor.name,
        status: 'pending',
      }));
      setResults(initialResults);

      // Group contracts by vendor to avoid creating duplicate suppliers
      const vendorGroups = new Map<string, ContractWithMissingSupplier[]>();
      for (const contract of selectedList) {
        const existing = vendorGroups.get(contract.vendor.sys_id) || [];
        existing.push(contract);
        vendorGroups.set(contract.vendor.sys_id, existing);
      }

      // Track created suppliers per vendor
      const createdSuppliers = new Map<string, string>();

      // Process each vendor group
      for (const [vendorSysId, vendorContracts] of vendorGroups) {
        const vendorName = vendorContracts[0].vendor.name;

        // Update status for all contracts in this group
        setResults(prev => prev.map(r =>
          vendorContracts.some(c => c.number === r.contractNumber)
            ? { ...r, status: 'creating_supplier' as const }
            : r
        ));

        let supplierSysId = createdSuppliers.get(vendorSysId);

        // Check if supplier already exists for this vendor
        if (!supplierSysId) {
          try {
            // First, check if a supplier already exists for this vendor
            const existingSuppliers = await api.get<Record<string, unknown>>('sn_fin_supplier', {
              sysparm_query: `u_vendor=${vendorSysId}`,
              sysparm_limit: 1,
              sysparm_fields: 'sys_id,name',
            });

            if (existingSuppliers.result && existingSuppliers.result.length > 0) {
              supplierSysId = getSysId(existingSuppliers.result[0].sys_id);
              createdSuppliers.set(vendorSysId, supplierSysId);
            }
          } catch (err) {
            console.log('Error checking existing suppliers:', err);
          }
        }

        // Create supplier if not found
        if (!supplierSysId) {
          const startTime = Date.now();
          const logId = addEntry({
            method: 'POST',
            url: `${settings.servicenow.instanceUrl}/api/now/table/sn_fin_supplier`,
            table: 'sn_fin_supplier',
            headers: {
              'Content-Type': 'application/json',
              'x-sn-apikey': settings.servicenow.apiKey,
            },
            body: {
              name: vendorName,
              legal_name: vendorName,
              u_vendor: vendorSysId,
            },
          });

          try {
            const supplierResponse = await api.create('sn_fin_supplier', {
              name: vendorName,
              legal_name: vendorName,
              u_vendor: vendorSysId,
            });

            const duration = Date.now() - startTime;
            updateEntry(logId, {
              responseStatus: 201,
              responseBody: supplierResponse,
              duration,
            });

            supplierSysId = getSysId(supplierResponse.result?.sys_id);
            createdSuppliers.set(vendorSysId, supplierSysId);
          } catch (err: any) {
            const duration = Date.now() - startTime;
            updateEntry(logId, {
              responseStatus: err.response?.status || 500,
              error: err.message,
              duration,
            });

            // Mark all contracts for this vendor as failed
            setResults(prev => prev.map(r =>
              vendorContracts.some(c => c.number === r.contractNumber)
                ? { ...r, status: 'error' as const, error: `Failed to create supplier: ${err.message}` }
                : r
            ));
            continue;
          }
        }

        // Now link each contract to the supplier
        for (const contract of vendorContracts) {
          setResults(prev => prev.map(r =>
            r.contractNumber === contract.number
              ? { ...r, status: 'linking_contract' as const, supplierSysId }
              : r
          ));

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
            body: {
              supplier: supplierSysId,
            },
          });

          try {
            await api.update('ast_contract', contract.sys_id, {
              supplier: supplierSysId,
            });

            const duration = Date.now() - startTime;
            updateEntry(logId, {
              responseStatus: 200,
              responseBody: { message: 'Contract updated' },
              duration,
            });

            setResults(prev => prev.map(r =>
              r.contractNumber === contract.number
                ? { ...r, status: 'success' as const, supplierSysId }
                : r
            ));
          } catch (err: any) {
            const duration = Date.now() - startTime;
            updateEntry(logId, {
              responseStatus: err.response?.status || 500,
              error: err.message,
              duration,
            });

            setResults(prev => prev.map(r =>
              r.contractNumber === contract.number
                ? { ...r, status: 'error' as const, error: `Failed to link contract: ${err.message}` }
                : r
            ));
          }
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['table', 'contracts'] });
      queryClient.invalidateQueries({ queryKey: ['table', 'suppliers'] });
    },
  });

  const handleProcess = () => {
    if (selectedContracts.size === 0) return;
    setIsProcessing(true);
    processMutation.mutate();
  };

  const successCount = results.filter(r => r.status === 'success').length;
  const errorCount = results.filter(r => r.status === 'error').length;
  const isComplete = results.length > 0 && results.every(r => r.status === 'success' || r.status === 'error');

  const getStatusIcon = (status: ProcessingResult['status']) => {
    switch (status) {
      case 'pending':
        return <div className="w-4 h-4 rounded-full border-2 border-gray-300" />;
      case 'creating_supplier':
      case 'linking_contract':
        return <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />;
      case 'success':
        return <CheckCircle className="w-4 h-4 text-green-500" />;
      case 'error':
        return <AlertTriangle className="w-4 h-4 text-red-500" />;
    }
  };

  const getStatusText = (status: ProcessingResult['status']) => {
    switch (status) {
      case 'pending':
        return 'Pending';
      case 'creating_supplier':
        return 'Creating supplier...';
      case 'linking_contract':
        return 'Linking to contract...';
      case 'success':
        return 'Completed';
      case 'error':
        return 'Failed';
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />

      {/* Modal */}
      <div className="relative bg-white rounded-xl shadow-xl w-full max-w-3xl max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-orange-100 rounded-lg">
              <Link2 className="w-5 h-5 text-orange-600" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-gray-900">
                Auto-Create Missing Suppliers
              </h2>
              <p className="text-sm text-gray-500">
                Create suppliers from vendors and link them to contracts
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
          {!isProcessing ? (
            <>
              {/* Info Banner */}
              <div className="mb-4 p-4 bg-blue-50 border border-blue-200 rounded-lg">
                <div className="flex items-start gap-3">
                  <Building2 className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
                  <div className="text-sm text-blue-800">
                    <p className="font-medium mb-1">How this works:</p>
                    <ol className="list-decimal list-inside space-y-1 text-blue-700">
                      <li>For each selected contract, a supplier will be created using the vendor's information</li>
                      <li>The new supplier will be linked to the vendor (u_vendor field)</li>
                      <li>The contract will be updated to reference the new supplier</li>
                    </ol>
                  </div>
                </div>
              </div>

              {contractsWithMissingSuppliers.length === 0 ? (
                <div className="text-center py-8">
                  <CheckCircle className="w-12 h-12 mx-auto text-green-500 mb-4" />
                  <p className="text-gray-600 font-medium">All contracts have suppliers!</p>
                  <p className="text-sm text-gray-500 mt-2">
                    No contracts with missing suppliers were found.
                  </p>
                </div>
              ) : (
                <>
                  {/* Select All */}
                  <div className="flex items-center justify-between mb-4">
                    <span className="text-sm font-medium text-gray-700">
                      {selectedContracts.size} of {contractsWithMissingSuppliers.length} contracts selected
                    </span>
                    <button
                      onClick={toggleAll}
                      className="text-sm text-blue-600 hover:text-blue-700"
                    >
                      {selectedContracts.size === contractsWithMissingSuppliers.length ? 'Deselect All' : 'Select All'}
                    </button>
                  </div>

                  {/* Contracts List */}
                  <div className="space-y-2">
                    {contractsWithMissingSuppliers.map((contract) => (
                      <div
                        key={contract.sys_id}
                        className={clsx(
                          'p-4 border rounded-lg transition-colors cursor-pointer',
                          selectedContracts.has(contract.sys_id)
                            ? 'border-orange-300 bg-orange-50'
                            : 'border-gray-200 bg-gray-50 hover:border-gray-300'
                        )}
                        onClick={() => toggleContract(contract.sys_id)}
                      >
                        <div className="flex items-start gap-3">
                          <input
                            type="checkbox"
                            checked={selectedContracts.has(contract.sys_id)}
                            onChange={() => toggleContract(contract.sys_id)}
                            className="mt-1 w-4 h-4 text-orange-600 border-gray-300 rounded focus:ring-orange-500"
                            onClick={e => e.stopPropagation()}
                          />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="font-medium text-gray-900">{contract.number}</span>
                              <span className="text-gray-400">-</span>
                              <span className="text-gray-600 truncate">{contract.short_description || '(No description)'}</span>
                            </div>
                            <div className="flex items-center gap-2 text-sm">
                              <span className="text-gray-500">Vendor:</span>
                              <span className="font-medium text-gray-700">{contract.vendor.name}</span>
                              <ArrowRight className="w-4 h-4 text-gray-400" />
                              <span className="text-orange-600 font-medium">New Supplier</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </>
          ) : (
            <>
              {/* Processing View */}
              <div className="space-y-3">
                {results.map((result, index) => (
                  <div
                    key={index}
                    className={clsx(
                      'p-4 border rounded-lg',
                      result.status === 'success' ? 'border-green-200 bg-green-50' :
                      result.status === 'error' ? 'border-red-200 bg-red-50' :
                      'border-gray-200 bg-gray-50'
                    )}
                  >
                    <div className="flex items-center gap-3">
                      {getStatusIcon(result.status)}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-gray-900">{result.contractNumber}</span>
                          <span className="text-gray-400">|</span>
                          <span className="text-gray-600">{result.vendorName}</span>
                        </div>
                        <div className="text-sm text-gray-500 mt-0.5">
                          {getStatusText(result.status)}
                          {result.error && (
                            <span className="text-red-600 ml-2">- {result.error}</span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Summary */}
              {isComplete && (
                <div className="mt-6 p-4 bg-gray-100 rounded-lg">
                  <div className="flex items-center justify-center gap-6">
                    <div className="text-center">
                      <div className="text-2xl font-bold text-green-600">{successCount}</div>
                      <div className="text-sm text-gray-500">Successful</div>
                    </div>
                    {errorCount > 0 && (
                      <div className="text-center">
                        <div className="text-2xl font-bold text-red-600">{errorCount}</div>
                        <div className="text-sm text-gray-500">Failed</div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-gray-200 bg-gray-50">
          <div className="text-sm text-gray-500">
            {!isProcessing && contractsWithMissingSuppliers.length > 0 && (
              <span className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-orange-500" />
                {contractsWithMissingSuppliers.length} contract{contractsWithMissingSuppliers.length !== 1 ? 's' : ''} with missing suppliers
              </span>
            )}
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={isComplete ? onSuccess : onClose}
              className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
            >
              {isComplete ? 'Done' : 'Cancel'}
            </button>
            {!isProcessing && contractsWithMissingSuppliers.length > 0 && (
              <button
                onClick={handleProcess}
                disabled={selectedContracts.size === 0}
                className={clsx(
                  'flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg transition-colors',
                  selectedContracts.size === 0
                    ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                    : 'bg-orange-600 text-white hover:bg-orange-700'
                )}
              >
                <RefreshCw className="w-4 h-4" />
                Create Suppliers ({selectedContracts.size})
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
