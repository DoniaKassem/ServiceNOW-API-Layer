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
  Upload,
  Printer,
  Paperclip,
} from 'lucide-react';
import { format } from 'date-fns';
import { clsx } from 'clsx';
import { useQuery } from '@tanstack/react-query';
import { useSettingsStore } from '../../stores/settingsStore';
import { getServiceNowAPI } from '../../services/servicenow';
import { TABLE_VIEW_CONFIG, type TableViewType } from '../../types';
import { getSysId, getRecordDisplayName, getDisplayValue } from '../../utils/serviceNowHelpers';
import { UpdateFromDocumentModal } from './UpdateFromDocumentModal';

interface RecordDetailModalProps {
  viewType: TableViewType;
  record: Record<string, unknown>;
  onClose: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onClone: () => void;
  onGeneratePrintout?: () => void;
  onRecordUpdated?: (updatedRecord: Record<string, unknown>) => void;
  onManageAttachments?: (record: Record<string, unknown>) => void;
}

export function RecordDetailModal({
  viewType,
  record,
  onClose,
  onEdit,
  onDelete,
  onClone,
  onGeneratePrintout,
  onRecordUpdated,
  onManageAttachments,
}: RecordDetailModalProps) {
  const config = TABLE_VIEW_CONFIG[viewType];
  const [activeTab, setActiveTab] = useState<'details' | 'related'>('details');
  const [showUpdateFromDocModal, setShowUpdateFromDocModal] = useState(false);

  // Check if this is a contract view (supports document update)
  const supportsDocumentUpdate = viewType === 'contracts';

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
            {supportsDocumentUpdate && (
              <button
                onClick={() => setShowUpdateFromDocModal(true)}
                className="flex items-center gap-2 px-3 py-2 text-sm text-purple-600 hover:bg-purple-50 rounded-lg"
              >
                <Upload className="w-4 h-4" />
                Update from Doc
              </button>
            )}
            {onGeneratePrintout && (
              <button
                onClick={onGeneratePrintout}
                className="flex items-center gap-2 px-3 py-2 text-sm text-blue-600 hover:bg-blue-50 rounded-lg"
              >
                <Printer className="w-4 h-4" />
                Generate Printout
              </button>
            )}
            {supportsDocumentUpdate && onManageAttachments && (
              <button
                onClick={() => onManageAttachments(record)}
                className="flex items-center gap-2 px-3 py-2 text-sm text-indigo-600 hover:bg-indigo-50 rounded-lg"
              >
                <Paperclip className="w-4 h-4" />
                Attachments
              </button>
            )}
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
                  recordSysId={getSysId(record.sys_id)}
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
            sys_id: {getSysId(record.sys_id)}
          </div>
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg"
          >
            Close
          </button>
        </div>
      </div>

      {/* Update from Document Modal */}
      {showUpdateFromDocModal && (
        <UpdateFromDocumentModal
          viewType={viewType}
          record={record}
          onClose={() => setShowUpdateFromDocModal(false)}
          onSuccess={(updatedRecord) => {
            setShowUpdateFromDocModal(false);
            onRecordUpdated?.(updatedRecord);
          }}
        />
      )}
    </div>
  );
}

// Field configuration for related record tables
const RELATED_RECORD_FIELDS: Record<string, { key: string; label: string; type?: 'date' | 'currency' | 'status' }[]> = {
  'ast_contract': [
    { key: 'number', label: 'Number' },
    { key: 'short_description', label: 'Description' },
    { key: 'vendor', label: 'Vendor' },
    { key: 'starts', label: 'Start Date', type: 'date' },
    { key: 'ends', label: 'End Date', type: 'date' },
    { key: 'state', label: 'State', type: 'status' },
    { key: 'contract_value', label: 'Value', type: 'currency' },
  ],
  'sn_shop_purchase_order': [
    { key: 'number', label: 'PO Number' },
    { key: 'short_description', label: 'Description' },
    { key: 'vendor', label: 'Vendor' },
    { key: 'po_date', label: 'PO Date', type: 'date' },
    { key: 'state', label: 'State', type: 'status' },
    { key: 'total_cost', label: 'Total Cost', type: 'currency' },
  ],
  'sn_shop_purchase_order_line': [
    { key: 'item', label: 'Item' },
    { key: 'short_description', label: 'Description' },
    { key: 'quantity', label: 'Quantity' },
    { key: 'unit_price', label: 'Unit Price', type: 'currency' },
    { key: 'total_price', label: 'Total', type: 'currency' },
  ],
  'fm_expense_line': [
    { key: 'number', label: 'Number' },
    { key: 'short_description', label: 'Description' },
    { key: 'amount', label: 'Amount', type: 'currency' },
    { key: 'expense_date', label: 'Date', type: 'date' },
    { key: 'state', label: 'State', type: 'status' },
  ],
  'clm_m2m_contract_asset': [
    { key: 'asset', label: 'Asset' },
    { key: 'contract', label: 'Contract' },
  ],
  'sn_fin_supplier': [
    { key: 'name', label: 'Name' },
    { key: 'supplier_id', label: 'Supplier ID' },
    { key: 'state', label: 'State', type: 'status' },
  ],
  'core_company': [
    { key: 'name', label: 'Name' },
    { key: 'city', label: 'City' },
    { key: 'country', label: 'Country' },
    { key: 'vendor', label: 'Is Vendor' },
  ],
  'service_offering': [
    { key: 'name', label: 'Name' },
    { key: 'short_description', label: 'Description' },
    { key: 'state', label: 'State', type: 'status' },
  ],
  'sn_shop_supplier_product': [
    { key: 'name', label: 'Product Name' },
    { key: 'short_description', label: 'Description' },
    { key: 'price', label: 'Price', type: 'currency' },
  ],
};

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
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());

  const toggleItemExpanded = (itemId: string) => {
    setExpandedItems(prev => {
      const next = new Set(prev);
      if (next.has(itemId)) {
        next.delete(itemId);
      } else {
        next.add(itemId);
      }
      return next;
    });
  };

  // Get configured fields for this table, or use defaults
  const fieldConfig = RELATED_RECORD_FIELDS[table] || [
    { key: 'name', label: 'Name' },
    { key: 'number', label: 'Number' },
    { key: 'short_description', label: 'Description' },
    { key: 'state', label: 'State', type: 'status' as const },
  ];

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

  // Format field value based on type
  const formatFieldValue = (value: unknown, type?: 'date' | 'currency' | 'status'): string => {
    const strValue = getDisplayValue(value);
    if (!strValue) return '-';

    if (type === 'date' && strValue) {
      try {
        const date = new Date(strValue);
        if (!isNaN(date.getTime())) {
          return format(date, 'MMM d, yyyy');
        }
      } catch {
        // Return as-is if date parsing fails
      }
    }

    if (type === 'currency' && strValue) {
      const num = parseFloat(strValue);
      if (!isNaN(num)) {
        return new Intl.NumberFormat('en-US', {
          style: 'currency',
          currency: 'USD',
        }).format(num);
      }
    }

    return strValue;
  };

  // Get status color class
  const getStatusColor = (status: string): string => {
    const lowerStatus = status.toLowerCase();
    if (lowerStatus.includes('active') || lowerStatus.includes('approved') || lowerStatus.includes('complete')) {
      return 'bg-green-100 text-green-800';
    }
    if (lowerStatus.includes('pending') || lowerStatus.includes('draft') || lowerStatus.includes('review')) {
      return 'bg-yellow-100 text-yellow-800';
    }
    if (lowerStatus.includes('cancelled') || lowerStatus.includes('rejected') || lowerStatus.includes('expired')) {
      return 'bg-red-100 text-red-800';
    }
    return 'bg-gray-100 text-gray-800';
  };

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 hover:bg-gray-100"
      >
        <div className="flex items-center gap-2">
          <Link2 className="w-4 h-4 text-gray-400" />
          <span className="text-sm font-medium text-gray-700">{label}</span>
          {data && data.length > 0 && (
            <span className="px-2 py-0.5 text-xs bg-blue-100 text-blue-700 rounded-full">
              {data.length}
            </span>
          )}
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
            <div className="space-y-3">
              {data.map((item: Record<string, unknown>, index: number) => {
                const itemSysId = getSysId(item.sys_id);
                const itemKey = itemSysId || `item-${index}`;
                const itemDisplayName = getRecordDisplayName(item);
                const isItemExpanded = expandedItems.has(itemKey);

                return (
                  <div
                    key={itemKey}
                    className="border border-gray-200 rounded-lg overflow-hidden"
                  >
                    {/* Item Header */}
                    <button
                      onClick={() => toggleItemExpanded(itemKey)}
                      className="w-full flex items-center justify-between p-3 bg-gray-50 hover:bg-gray-100"
                    >
                      <div className="flex items-center gap-2">
                        <FileText className="w-4 h-4 text-gray-400" />
                        <span className="text-sm font-medium text-gray-900">
                          {itemDisplayName}
                        </span>
                      </div>
                      <ChevronRight
                        className={clsx(
                          'w-4 h-4 text-gray-400 transition-transform',
                          isItemExpanded && 'rotate-90'
                        )}
                      />
                    </button>

                    {/* Item Details */}
                    {isItemExpanded && (
                      <div className="p-3 bg-white border-t border-gray-200">
                        <div className="grid grid-cols-2 gap-3">
                          {fieldConfig.map(({ key, label: fieldLabel, type }) => {
                            const value = item[key];
                            if (value === undefined || value === null) return null;

                            const formattedValue = formatFieldValue(value, type);
                            if (formattedValue === '-') return null;

                            return (
                              <div key={key} className="min-w-0">
                                <label className="block text-xs font-medium text-gray-500 mb-0.5">
                                  {fieldLabel}
                                </label>
                                {type === 'status' ? (
                                  <span className={clsx(
                                    'inline-block px-2 py-0.5 text-xs font-medium rounded',
                                    getStatusColor(formattedValue)
                                  )}>
                                    {formattedValue}
                                  </span>
                                ) : (
                                  <span className="text-sm text-gray-900 break-words">
                                    {formattedValue}
                                  </span>
                                )}
                              </div>
                            );
                          })}
                        </div>

                        {/* sys_id at the bottom */}
                        <div className="mt-3 pt-2 border-t border-gray-100">
                          <span className="text-xs text-gray-400">
                            sys_id: {itemSysId}
                          </span>
                        </div>
                      </div>
                    )}
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
