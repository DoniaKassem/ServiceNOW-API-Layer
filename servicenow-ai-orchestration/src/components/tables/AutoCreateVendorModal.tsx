import { useState, useMemo } from 'react';
import {
  X,
  AlertTriangle,
  CheckCircle,
  Building2,
  Loader2,
  Link2,
  Plus,
  ArrowRight,
} from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { clsx } from 'clsx';
import { useSettingsStore } from '../../stores/settingsStore';
import { useRequestLogStore } from '../../stores/requestLogStore';
import { getServiceNowAPI, initServiceNowAPI } from '../../services/servicenow';
import { getSysId, getDisplayValue } from '../../utils/serviceNowHelpers';

interface SupplierWithMissingVendor {
  sys_id: string;
  name: string;
  legal_name?: string;
  u_vendor: unknown;
}

interface CreationResult {
  supplierSysId: string;
  supplierName: string;
  status: 'pending' | 'creating_vendor' | 'linking_supplier' | 'success' | 'error';
  error?: string;
  vendorSysId?: string;
}

interface AutoCreateVendorModalProps {
  suppliers: Record<string, unknown>[];
  onClose: () => void;
  onSuccess: () => void;
}

export function AutoCreateVendorModal({
  suppliers,
  onClose,
  onSuccess,
}: AutoCreateVendorModalProps) {
  const { settings } = useSettingsStore();
  const { addEntry, updateEntry } = useRequestLogStore();
  const queryClient = useQueryClient();

  const [selectedSuppliers, setSelectedSuppliers] = useState<string[]>([]);
  const [results, setResults] = useState<CreationResult[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);

  // Parse suppliers with missing vendors
  const suppliersWithMissingVendors = useMemo(() => {
    return suppliers
      .filter(supplier => {
        const vendorValue = getDisplayValue(supplier.u_vendor);
        // Check if vendor is missing or is a placeholder like "{{vendor.sys_id}}"
        return !vendorValue ||
               vendorValue.includes('{{') ||
               vendorValue === '-' ||
               vendorValue === '';
      })
      .map(supplier => {
        return {
          sys_id: getSysId(supplier.sys_id),
          name: getDisplayValue(supplier.name),
          legal_name: getDisplayValue(supplier.legal_name),
          u_vendor: supplier.u_vendor,
        } as SupplierWithMissingVendor;
      });
  }, [suppliers]);

  // Get API instance
  const getApi = () => {
    if (!settings.servicenow.apiKey || !settings.servicenow.instanceUrl) {
      throw new Error('API not configured');
    }
    try {
      return getServiceNowAPI(settings.servicenow.instanceUrl, settings.servicenow.apiKey);
    } catch {
      return initServiceNowAPI(settings.servicenow.instanceUrl, settings.servicenow.apiKey);
    }
  };

  // Toggle supplier selection
  const toggleSupplier = (sysId: string) => {
    setSelectedSuppliers(prev =>
      prev.includes(sysId)
        ? prev.filter(id => id !== sysId)
        : [...prev, sysId]
    );
  };

  // Select all
  const selectAll = () => {
    setSelectedSuppliers(suppliersWithMissingVendors.map(s => s.sys_id));
  };

  // Create vendors mutation
  const createVendorsMutation = useMutation({
    mutationFn: async () => {
      const api = getApi();
      const selectedList = suppliersWithMissingVendors.filter(s =>
        selectedSuppliers.includes(s.sys_id)
      );

      // Initialize results
      const initialResults: CreationResult[] = selectedList.map(s => ({
        supplierSysId: s.sys_id,
        supplierName: s.name,
        status: 'pending',
      }));
      setResults(initialResults);

      // Process each supplier
      for (const supplier of selectedList) {
        // Update status to creating
        setResults(prev => prev.map(r =>
          r.supplierSysId === supplier.sys_id
            ? { ...r, status: 'creating_vendor' as const }
            : r
        ));

        const vendorName = supplier.legal_name || supplier.name;
        const startTime = Date.now();

        // Create vendor
        const createVendorLogId = addEntry({
          method: 'POST',
          url: `${settings.servicenow.instanceUrl}/api/now/table/core_company`,
          table: 'core_company',
          headers: {
            'Content-Type': 'application/json',
            'x-sn-apikey': settings.servicenow.apiKey,
          },
          body: {
            name: vendorName,
            vendor: 'true',
            vendor_manager: settings.defaults.vendorManager,
          },
        });

        try {
          const vendorResponse = await api.create('core_company', {
            name: vendorName,
            vendor: 'true',
            vendor_manager: settings.defaults.vendorManager,
          });

          const duration = Date.now() - startTime;
          updateEntry(createVendorLogId, {
            responseStatus: 201,
            responseBody: vendorResponse,
            duration,
          });

          const vendorSysId = getSysId((vendorResponse.result as any)?.sys_id);

          // Update status to linking
          setResults(prev => prev.map(r =>
            r.supplierSysId === supplier.sys_id
              ? { ...r, status: 'linking_supplier' as const, vendorSysId }
              : r
          ));

          // Link supplier to vendor
          const linkStartTime = Date.now();
          const linkLogId = addEntry({
            method: 'PATCH',
            url: `${settings.servicenow.instanceUrl}/api/now/table/sn_fin_supplier/${supplier.sys_id}`,
            table: 'sn_fin_supplier',
            recordSysId: supplier.sys_id,
            headers: {
              'Content-Type': 'application/json',
              'x-sn-apikey': settings.servicenow.apiKey,
            },
            body: { u_vendor: vendorSysId },
          });

          try {
            await api.update('sn_fin_supplier', supplier.sys_id, {
              u_vendor: vendorSysId,
            });

            const linkDuration = Date.now() - linkStartTime;
            updateEntry(linkLogId, {
              responseStatus: 200,
              duration: linkDuration,
            });

            // Mark as success
            setResults(prev => prev.map(r =>
              r.supplierSysId === supplier.sys_id
                ? { ...r, status: 'success' as const }
                : r
            ));
          } catch (err: any) {
            const linkDuration = Date.now() - linkStartTime;
            updateEntry(linkLogId, {
              responseStatus: err.response?.status || 500,
              error: err.message,
              duration: linkDuration,
            });

            setResults(prev => prev.map(r =>
              r.supplierSysId === supplier.sys_id
                ? { ...r, status: 'error' as const, error: `Failed to link supplier: ${err.message}` }
                : r
            ));
          }
        } catch (err: any) {
          const duration = Date.now() - startTime;
          updateEntry(createVendorLogId, {
            responseStatus: err.response?.status || 500,
            error: err.message,
            duration,
          });

          setResults(prev => prev.map(r =>
            r.supplierSysId === supplier.sys_id
              ? { ...r, status: 'error' as const, error: `Failed to create vendor: ${err.message}` }
              : r
          ));
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['table', 'suppliers'] });
      queryClient.invalidateQueries({ queryKey: ['table', 'vendors'] });
    },
  });

  const handleCreate = async () => {
    setIsProcessing(true);
    await createVendorsMutation.mutateAsync();
    setIsProcessing(false);
  };

  const getStatusIcon = (status: CreationResult['status']) => {
    switch (status) {
      case 'success':
        return <CheckCircle className="w-4 h-4 text-green-500" />;
      case 'error':
        return <AlertTriangle className="w-4 h-4 text-red-500" />;
      case 'creating_vendor':
      case 'linking_supplier':
        return <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />;
      default:
        return <div className="w-4 h-4 rounded-full border-2 border-gray-300" />;
    }
  };

  const getStatusText = (status: CreationResult['status']) => {
    switch (status) {
      case 'success':
        return 'Completed';
      case 'creating_vendor':
        return 'Creating vendor...';
      case 'linking_supplier':
        return 'Linking supplier...';
      case 'error':
        return 'Failed';
      default:
        return 'Pending';
    }
  };

  const isComplete = results.length > 0 && results.every(r => r.status === 'success' || r.status === 'error');
  const successCount = results.filter(r => r.status === 'success').length;
  const errorCount = results.filter(r => r.status === 'error').length;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-2xl w-[700px] max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-100 rounded-lg">
              <Building2 className="w-5 h-5 text-blue-600" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Auto-Create Vendors</h2>
              <p className="text-sm text-gray-500">
                Create vendors from suppliers and link them automatically
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
        <div className="flex-1 overflow-y-auto p-4">
          {results.length === 0 ? (
            <>
              {/* Instructions */}
              {suppliersWithMissingVendors.length > 0 && (
                <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                  <div className="flex items-start gap-2">
                    <Building2 className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
                    <div className="text-sm text-blue-700">
                      <p className="font-medium mb-2">This will:</p>
                      <ol className="list-decimal list-inside space-y-1">
                        <li>For each selected supplier, a vendor will be created with the supplier's name</li>
                        <li>The new vendor will be marked with vendor=true flag</li>
                        <li>The supplier will be linked to the new vendor (u_vendor field)</li>
                      </ol>
                    </div>
                  </div>
                </div>
              )}

              {/* No suppliers message */}
              {suppliersWithMissingVendors.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8">
                  <CheckCircle className="w-12 h-12 mx-auto text-green-500 mb-4" />
                  <p className="text-gray-600 font-medium">All suppliers have vendors!</p>
                  <p className="text-sm text-gray-500 mt-2">
                    No suppliers with missing vendors were found.
                  </p>
                </div>
              ) : (
                <>
                  {/* Selection Controls */}
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-sm text-gray-600">
                      {selectedSuppliers.length} of {suppliersWithMissingVendors.length} selected
                    </span>
                    <button
                      onClick={selectAll}
                      className="text-sm text-blue-600 hover:text-blue-700 font-medium"
                    >
                      Select All
                    </button>
                  </div>

                  {/* Supplier List */}
                  <div className="space-y-2">
                    {suppliersWithMissingVendors.map((supplier) => (
                      <label
                        key={supplier.sys_id}
                        className={clsx(
                          'flex items-start gap-3 p-3 border rounded-lg cursor-pointer transition-colors',
                          selectedSuppliers.includes(supplier.sys_id)
                            ? 'border-blue-300 bg-blue-50'
                            : 'border-gray-200 hover:border-gray-300'
                        )}
                      >
                        <input
                          type="checkbox"
                          checked={selectedSuppliers.includes(supplier.sys_id)}
                          onChange={() => toggleSupplier(supplier.sys_id)}
                          className="mt-1 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                        />
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-gray-900">{supplier.name}</span>
                            <ArrowRight className="w-4 h-4 text-gray-400" />
                            <span className="text-sm text-gray-600">
                              Create: {supplier.legal_name || supplier.name}
                            </span>
                          </div>
                          {supplier.legal_name && supplier.legal_name !== supplier.name && (
                            <p className="text-xs text-gray-500 mt-1">Legal: {supplier.legal_name}</p>
                          )}
                        </div>
                      </label>
                    ))}
                  </div>
                </>
              )}
            </>
          ) : (
            <>
              {/* Results Summary */}
              {isComplete && (
                <div className="mb-4 p-3 bg-gray-50 border border-gray-200 rounded-lg">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-gray-600">
                      Processed {results.length} supplier{results.length !== 1 ? 's' : ''}
                    </span>
                    <div className="flex items-center gap-4">
                      <span className="text-green-600">{successCount} successful</span>
                      {errorCount > 0 && <span className="text-red-600">{errorCount} failed</span>}
                    </div>
                  </div>
                </div>
              )}

              {/* Results List */}
              <div className="space-y-2">
                {results.map((result) => (
                  <div
                    key={result.supplierSysId}
                    className={clsx(
                      'p-3 border rounded-lg',
                      result.status === 'success' && 'border-green-200 bg-green-50',
                      result.status === 'error' && 'border-red-200 bg-red-50',
                      (result.status === 'creating_vendor' || result.status === 'linking_supplier') && 'border-blue-200 bg-blue-50',
                      result.status === 'pending' && 'border-gray-200'
                    )}
                  >
                    <div className="flex items-center gap-3">
                      {getStatusIcon(result.status)}
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-gray-900">{result.supplierName}</span>
                          <span className="text-gray-400">|</span>
                          <span className="text-sm text-gray-600">{getStatusText(result.status)}</span>
                        </div>
                        {result.error && (
                          <p className="text-xs text-red-600 mt-1">{result.error}</p>
                        )}
                        {result.vendorSysId && result.status === 'success' && (
                          <p className="text-xs text-green-600 mt-1">
                            Vendor created and linked successfully
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 p-4 border-t border-gray-200 bg-gray-50">
          {isComplete ? (
            <button
              onClick={() => {
                onSuccess();
                onClose();
              }}
              className="px-4 py-2 text-sm font-medium text-white bg-green-600 hover:bg-green-700 rounded-lg"
            >
              Done
            </button>
          ) : (
            <>
              <button
                onClick={onClose}
                disabled={isProcessing}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleCreate}
                disabled={selectedSuppliers.length === 0 || isProcessing}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isProcessing ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Creating...
                  </>
                ) : (
                  <>
                    <Plus className="w-4 h-4" />
                    Create {selectedSuppliers.length} Vendor{selectedSuppliers.length !== 1 ? 's' : ''}
                  </>
                )}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}