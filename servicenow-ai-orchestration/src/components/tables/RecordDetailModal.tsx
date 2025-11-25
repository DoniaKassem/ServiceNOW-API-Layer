import { useState, useMemo, type ReactNode } from 'react';
import {
  X,
  Edit3,
  Trash2,
  Copy,
  ExternalLink,
  Link2,
  FileText,
  ChevronRight,
  Loader2,
} from 'lucide-react';
import { format } from 'date-fns';
import { clsx } from 'clsx';
import { useQuery } from '@tanstack/react-query';
import { useSettingsStore } from '../../stores/settingsStore';
import { getServiceNowAPI } from '../../services/servicenow';
import { TABLE_VIEW_CONFIG, type TableViewType } from '../../types';
import { getSysId, getRecordDisplayName } from '../../utils/serviceNowHelpers';

interface RecordDetailModalProps {
  viewType: TableViewType;
  record: Record<string, unknown>;
  onClose: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onClone: () => void;
}

export function RecordDetailModal({
  viewType,
  record,
  onClose,
  onEdit,
  onDelete,
  onClone,
}: RecordDetailModalProps) {
  const config = TABLE_VIEW_CONFIG[viewType];
  const [activeTab, setActiveTab] = useState<'details' | 'related'>('details');

  // Get display name for the record
  const displayName = getRecordDisplayName(record);

  // Format field value for display
  const formatValue = (key: string, value: unknown): ReactNode => {
    if (value === null || value === undefined || value === '') {
      return <span className="text-gray-400">-</span>;
    }

    // Handle reference fields
    if (typeof value === 'object' && value !== null) {
      const refValue = value as { display_value?: string; value?: string; link?: string };
      if (refValue.display_value || refValue.value) {
        return (
          <span className="flex items-center gap-1">
            <span>{refValue.display_value || refValue.value}</span>
            {refValue.link && (
              <a
                href={refValue.link}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-500 hover:text-blue-700"
                onClick={(e) => e.stopPropagation()}
              >
                <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </span>
        );
      }
      return <span className="text-gray-400">[Object]</span>;
    }

    // Handle dates
    if (key.includes('date') || key === 'starts' || key === 'ends' || key === 'created' || key === 'updated') {
      try {
        const date = new Date(value as string);
        if (!isNaN(date.getTime())) {
          return format(date, 'MMM d, yyyy HH:mm');
        }
      } catch {
        // Not a valid date, return as-is
      }
    }

    // Handle booleans
    if (value === 'true' || value === true) {
      return <span className="text-green-600">Yes</span>;
    }
    if (value === 'false' || value === false) {
      return <span className="text-red-600">No</span>;
    }

    // Handle URLs
    if (typeof value === 'string' && (value.startsWith('http://') || value.startsWith('https://'))) {
      return (
        <a
          href={value}
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-600 hover:underline"
        >
          {value}
        </a>
      );
    }

    return String(value);
  };

  // Format field key for display
  const formatKey = (key: string): string => {
    return key
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase());
  };

  // Group fields by category
  const groupedFields = useMemo(() => {
    const systemFields = ['sys_id', 'sys_created_on', 'sys_updated_on', 'sys_created_by', 'sys_updated_by', 'sys_mod_count'];
    const groups: Record<string, [string, unknown][]> = {
      primary: [],
      details: [],
      system: [],
    };

    // Primary fields (name, number, status, etc.)
    const primaryKeys = ['name', 'number', 'display_name', 'short_description', 'status', 'state'];

    for (const [key, value] of Object.entries(record)) {
      if (primaryKeys.includes(key)) {
        groups.primary.push([key, value]);
      } else if (systemFields.includes(key)) {
        groups.system.push([key, value]);
      } else {
        groups.details.push([key, value]);
      }
    }

    return groups;
  }, [record]);

  // Related records configuration
  const relatedRecordsConfig: Record<TableViewType, { label: string; table: string; field: string }[]> = {
    vendors: [
      { label: 'Linked Supplier', table: 'sn_fin_supplier', field: 'u_vendor' },
      { label: 'Contracts', table: 'ast_contract', field: 'vendor' },
      { label: 'Service Offerings', table: 'service_offering', field: 'vendor' },
    ],
    suppliers: [
      { label: 'Linked Vendor', table: 'core_company', field: 'supplier' },
      { label: 'Purchase Orders', table: 'sn_shop_purchase_order', field: 'supplier' },
      { label: 'Products', table: 'sn_shop_supplier_product', field: 'supplier' },
    ],
    contracts: [
      { label: 'Expense Lines', table: 'fm_expense_line', field: 'contract' },
      { label: 'Covered Assets', table: 'clm_m2m_contract_asset', field: 'contract' },
    ],
    purchase_orders: [
      { label: 'PO Lines', table: 'sn_shop_purchase_order_line', field: 'purchase_order' },
    ],
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-2xl w-[800px] max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">
              {displayName}
            </h2>
            <p className="text-sm text-gray-500">{config.label} Record</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onEdit}
              className="flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded-lg"
            >
              <Edit3 className="w-4 h-4" />
              Edit
            </button>
            <button
              onClick={onClone}
              className="flex items-center gap-2 px-3 py-2 text-sm text-blue-600 hover:bg-blue-50 rounded-lg"
            >
              <Copy className="w-4 h-4" />
              Clone
            </button>
            <button
              onClick={onDelete}
              className="flex items-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-red-50 rounded-lg"
            >
              <Trash2 className="w-4 h-4" />
              Delete
            </button>
            <button
              onClick={onClose}
              className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-200">
          <button
            onClick={() => setActiveTab('details')}
            className={clsx(
              'px-4 py-2 text-sm font-medium border-b-2 -mb-px',
              activeTab === 'details'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            )}
          >
            Details
          </button>
          <button
            onClick={() => setActiveTab('related')}
            className={clsx(
              'px-4 py-2 text-sm font-medium border-b-2 -mb-px',
              activeTab === 'related'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            )}
          >
            Related Records
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {activeTab === 'details' ? (
            <div className="space-y-6">
              {/* Primary Fields */}
              {groupedFields.primary.length > 0 && (
                <div>
                  <h3 className="text-sm font-medium text-gray-500 mb-3">Primary Information</h3>
                  <div className="grid grid-cols-2 gap-4">
                    {groupedFields.primary.map(([key, value]) => (
                      <div key={key}>
                        <label className="block text-xs font-medium text-gray-500 mb-1">
                          {formatKey(key)}
                        </label>
                        <div className="text-sm text-gray-900">{formatValue(key, value)}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Detail Fields */}
              {groupedFields.details.length > 0 && (
                <div>
                  <h3 className="text-sm font-medium text-gray-500 mb-3">Details</h3>
                  <div className="grid grid-cols-2 gap-4">
                    {groupedFields.details.map(([key, value]) => (
                      <div key={key}>
                        <label className="block text-xs font-medium text-gray-500 mb-1">
                          {formatKey(key)}
                        </label>
                        <div className="text-sm text-gray-900">{formatValue(key, value)}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* System Fields */}
              {groupedFields.system.length > 0 && (
                <div>
                  <h3 className="text-sm font-medium text-gray-500 mb-3">System Information</h3>
                  <div className="grid grid-cols-2 gap-4">
                    {groupedFields.system.map(([key, value]) => (
                      <div key={key}>
                        <label className="block text-xs font-medium text-gray-500 mb-1">
                          {formatKey(key)}
                        </label>
                        <div className="text-sm text-gray-900">{formatValue(key, value)}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              {relatedRecordsConfig[viewType]?.map((relConfig) => (
                <RelatedRecordsSection
                  key={relConfig.table}
                  label={relConfig.label}
                  table={relConfig.table}
                  field={relConfig.field}
                  recordSysId={record.sys_id as string}
                />
              ))}

              {!relatedRecordsConfig[viewType]?.length && (
                <div className="text-center text-gray-500 py-8">
                  No related records configured for this view
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between p-4 border-t border-gray-200 bg-gray-50">
          <div className="text-xs text-gray-500">
            sys_id: {record.sys_id as string}
          </div>
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

// Related Records Section Component
function RelatedRecordsSection({
  label,
  table,
  field,
  recordSysId,
}: {
  label: string;
  table: string;
  field: string;
  recordSysId: string;
}) {
  const { settings } = useSettingsStore();
  const [isExpanded, setIsExpanded] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['related', table, field, recordSysId],
    queryFn: async () => {
      const api = getServiceNowAPI(settings.servicenow.instanceUrl, settings.servicenow.apiKey);
      const response = await api.get<Record<string, unknown>>(table, {
        sysparm_query: `${field}=${recordSysId}`,
        sysparm_limit: 10,
        sysparm_display_value: 'all',
      });
      return response.result || [];
    },
    enabled: isExpanded && !!settings.servicenow.apiKey,
  });

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 hover:bg-gray-100"
      >
        <div className="flex items-center gap-2">
          <Link2 className="w-4 h-4 text-gray-400" />
          <span className="text-sm font-medium text-gray-700">{label}</span>
        </div>
        <ChevronRight
          className={clsx(
            'w-4 h-4 text-gray-400 transition-transform',
            isExpanded && 'rotate-90'
          )}
        />
      </button>

      {isExpanded && (
        <div className="p-4">
          {isLoading ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="w-5 h-5 text-blue-500 animate-spin" />
            </div>
          ) : data && data.length > 0 ? (
            <div className="space-y-2">
              {data.map((item: Record<string, unknown>, index: number) => {
                const itemSysId = getSysId(item.sys_id);
                const itemDisplayName = getRecordDisplayName(item);
                return (
                  <div
                    key={itemSysId || index}
                    className="flex items-center justify-between p-2 bg-gray-50 rounded-lg"
                  >
                    <div className="flex items-center gap-2">
                      <FileText className="w-4 h-4 text-gray-400" />
                      <span className="text-sm text-gray-700">
                        {itemDisplayName}
                      </span>
                    </div>
                    <span className="text-xs text-gray-400">
                      {itemSysId}
                    </span>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-center text-gray-500 text-sm py-4">
              No related records found
            </div>
          )}
        </div>
      )}
    </div>
  );
}
