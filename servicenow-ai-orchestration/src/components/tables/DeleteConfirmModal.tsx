import { useState } from 'react';
import { X, Trash2, Loader2, AlertTriangle, Link2 } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useSettingsStore } from '../../stores/settingsStore';
import { getServiceNowAPI } from '../../services/servicenow';
import type { TableViewType } from '../../types';

interface DeleteConfirmModalProps {
  viewType: TableViewType;
  sysIds: string[];
  onClose: () => void;
  onConfirm: () => void;
  isDeleting: boolean;
}

// Dependent record configurations
const DEPENDENT_RECORDS: Record<TableViewType, {
  label: string;
  table: string;
  field: string;
  blocking: boolean;
}[]> = {
  vendors: [
    { label: 'Contracts', table: 'ast_contract', field: 'vendor', blocking: true },
    { label: 'Service Offerings', table: 'service_offering', field: 'vendor', blocking: false },
  ],
  suppliers: [
    { label: 'Purchase Orders', table: 'sn_shop_purchase_order', field: 'supplier', blocking: true },
    { label: 'Products', table: 'sn_shop_supplier_product', field: 'supplier', blocking: false },
  ],
  contracts: [
    { label: 'Expense Lines', table: 'fm_expense_line', field: 'contract', blocking: false },
    { label: 'Covered Assets', table: 'clm_m2m_contract_asset', field: 'contract', blocking: false },
  ],
  purchase_orders: [
    { label: 'PO Lines', table: 'sn_shop_purchase_order_line', field: 'purchase_order', blocking: false },
  ],
};

export function DeleteConfirmModal({
  viewType,
  sysIds,
  onClose,
  onConfirm,
  isDeleting,
}: DeleteConfirmModalProps) {
  const { settings } = useSettingsStore();
  const dependentConfigs = DEPENDENT_RECORDS[viewType];

  const [cascadeDelete, setCascadeDelete] = useState(false);

  // Check for dependent records
  const { data: dependentRecords, isLoading } = useQuery({
    queryKey: ['dependents', viewType, sysIds],
    queryFn: async () => {
      const api = getServiceNowAPI(settings.servicenow.instanceUrl, settings.servicenow.apiKey);
      const results: { config: typeof dependentConfigs[0]; count: number }[] = [];

      for (const depConfig of dependentConfigs) {
        try {
          const query = sysIds.map((id) => `${depConfig.field}=${id}`).join('^OR');
          const response = await api.get<Record<string, unknown>>(depConfig.table, {
            sysparm_query: query,
            sysparm_limit: 1,
            sysparm_fields: 'sys_id',
          });
          const count = response.result?.length || 0;
          if (count > 0) {
            // Get actual count with another query
            const countResponse = await api.get<Record<string, unknown>>(depConfig.table, {
              sysparm_query: query,
              sysparm_count: true,
            } as any);
            results.push({
              config: depConfig,
              count: (countResponse as any).result?.length || count,
            });
          }
        } catch (err) {
          console.error(`Error checking dependents for ${depConfig.table}:`, err);
        }
      }

      return results;
    },
    enabled: !!settings.servicenow.apiKey && dependentConfigs.length > 0,
  });

  const hasBlockingDependents = dependentRecords?.some(
    (dep) => dep.config.blocking && dep.count > 0
  );

  const hasDependents = (dependentRecords?.length || 0) > 0;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-2xl w-[500px] max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-red-100 rounded-lg">
              <Trash2 className="w-5 h-5 text-red-600" />
            </div>
            <h2 className="text-lg font-semibold text-gray-900">Confirm Delete</h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Warning */}
          <div className="flex items-start gap-3 p-3 bg-red-50 border border-red-200 rounded-lg">
            <AlertTriangle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-red-700">
                You are about to delete {sysIds.length} {sysIds.length === 1 ? 'record' : 'records'}
              </p>
              <p className="text-sm text-red-600 mt-1">
                This action will set the record(s) to inactive. This may affect related records.
              </p>
            </div>
          </div>

          {/* Records to delete */}
          <div>
            <h3 className="text-sm font-medium text-gray-700 mb-2">Records to delete:</h3>
            <div className="max-h-32 overflow-y-auto bg-gray-50 rounded-lg p-2 space-y-1">
              {sysIds.map((sysId) => (
                <div key={sysId} className="text-sm font-mono text-gray-600">
                  {sysId}
                </div>
              ))}
            </div>
          </div>

          {/* Dependent records check */}
          {isLoading ? (
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <Loader2 className="w-4 h-4 animate-spin" />
              Checking for dependent records...
            </div>
          ) : hasDependents ? (
            <div className="space-y-3">
              <h3 className="text-sm font-medium text-gray-700">Dependent records found:</h3>
              <div className="space-y-2">
                {dependentRecords?.map((dep) => (
                  <div
                    key={dep.config.table}
                    className={`flex items-center gap-2 p-2 rounded-lg ${
                      dep.config.blocking ? 'bg-red-50 border border-red-200' : 'bg-yellow-50 border border-yellow-200'
                    }`}
                  >
                    <Link2 className={`w-4 h-4 ${dep.config.blocking ? 'text-red-500' : 'text-yellow-500'}`} />
                    <span className="text-sm">
                      <span className="font-medium">{dep.count}</span> {dep.config.label}
                    </span>
                    {dep.config.blocking && (
                      <span className="text-xs text-red-600 ml-auto">Blocking</span>
                    )}
                  </div>
                ))}
              </div>

              {hasBlockingDependents ? (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
                  <p className="text-sm text-red-700">
                    Cannot delete: There are blocking dependent records that must be removed first.
                  </p>
                </div>
              ) : (
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={cascadeDelete}
                    onChange={(e) => setCascadeDelete(e.target.checked)}
                    className="rounded border-gray-300 text-red-600 focus:ring-red-500"
                  />
                  <span className="text-sm text-gray-700">
                    Also delete dependent records (cascade delete)
                  </span>
                </label>
              )}
            </div>
          ) : dependentConfigs.length > 0 ? (
            <div className="flex items-center gap-2 text-sm text-green-600">
              <span>No dependent records found</span>
            </div>
          ) : null}
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
            onClick={onConfirm}
            disabled={isDeleting || hasBlockingDependents}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isDeleting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Deleting...
              </>
            ) : (
              <>
                <Trash2 className="w-4 h-4" />
                Delete {sysIds.length} {sysIds.length === 1 ? 'Record' : 'Records'}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
