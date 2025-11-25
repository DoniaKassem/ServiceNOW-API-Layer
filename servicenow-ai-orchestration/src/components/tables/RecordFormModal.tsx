import React, { useState, useEffect, useCallback } from 'react';
import {
  X,
  Save,
  Loader2,
  AlertTriangle,
  Search,
  Link2,
  Check,
} from 'lucide-react';
import { clsx } from 'clsx';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useSettingsStore } from '../../stores/settingsStore';
import { useRequestLogStore } from '../../stores/requestLogStore';
import { useWorkflowStore } from '../../stores/workflowStore';
import { getServiceNowAPI, initServiceNowAPI } from '../../services/servicenow';
import { TABLE_VIEW_CONFIG, type TableViewType } from '../../types';

interface RecordFormModalProps {
  viewType: TableViewType;
  mode: 'create' | 'edit';
  record?: Record<string, unknown>;
  onClose: () => void;
  onSuccess: () => void;
}

// Field configurations for each table type
const FIELD_CONFIGS: Record<TableViewType, {
  field: string;
  label: string;
  type: 'text' | 'textarea' | 'select' | 'date' | 'reference' | 'boolean' | 'number';
  required?: boolean;
  referenceTable?: string;
  options?: { value: string; label: string }[];
}[]> = {
  vendors: [
    { field: 'name', label: 'Name', type: 'text', required: true },
    { field: 'website', label: 'Website', type: 'text' },
    { field: 'vendor_type', label: 'Vendor Type', type: 'select', options: [
      { value: 'advisory', label: 'Advisory' },
      { value: 'contractor', label: 'Contractor' },
      { value: 'manufacturer', label: 'Manufacturer' },
      { value: 'reseller', label: 'Reseller' },
      { value: 'software', label: 'Software' },
    ]},
    { field: 'vendor_manager', label: 'Vendor Manager', type: 'text' },
    { field: 'street', label: 'Street', type: 'text' },
    { field: 'city', label: 'City', type: 'text' },
    { field: 'state', label: 'State', type: 'text' },
    { field: 'country', label: 'Country', type: 'text' },
    { field: 'notes', label: 'Notes', type: 'textarea' },
  ],
  suppliers: [
    { field: 'name', label: 'Name', type: 'text', required: true },
    { field: 'legal_name', label: 'Legal Name', type: 'text' },
    { field: 'u_vendor', label: 'Linked Vendor', type: 'reference', referenceTable: 'core_company' },
    { field: 'web_site', label: 'Website', type: 'text' },
    { field: 'street', label: 'Street', type: 'text' },
    { field: 'city', label: 'City', type: 'text' },
    { field: 'state', label: 'State', type: 'text' },
    { field: 'country', label: 'Country', type: 'text' },
    { field: 'zip', label: 'ZIP', type: 'text' },
    { field: 'short_description', label: 'Description', type: 'textarea' },
  ],
  contracts: [
    { field: 'short_description', label: 'Description', type: 'text', required: true },
    { field: 'vendor', label: 'Vendor', type: 'reference', referenceTable: 'core_company', required: true },
    { field: 'supplier', label: 'Supplier', type: 'reference', referenceTable: 'sn_fin_supplier' },
    { field: 'vendor_contract', label: 'Vendor Contract Number', type: 'text' },
    { field: 'contract_administrator', label: 'Contract Administrator', type: 'text' },
    { field: 'approver', label: 'Approver', type: 'text' },
    { field: 'starts', label: 'Start Date', type: 'date', required: true },
    { field: 'ends', label: 'End Date', type: 'date', required: true },
    { field: 'renewable', label: 'Renewable', type: 'boolean' },
    { field: 'payment_amount', label: 'Payment Amount', type: 'number' },
    { field: 'payment_schedule', label: 'Payment Schedule', type: 'select', options: [
      { value: 'annually', label: 'Annually' },
      { value: 'monthly', label: 'Monthly' },
      { value: 'quarterly', label: 'Quarterly' },
      { value: 'one_time', label: 'One Time' },
    ]},
    { field: 'total_cost', label: 'Total Cost', type: 'number' },
    { field: 'state', label: 'State', type: 'select', options: [
      { value: 'draft', label: 'Draft' },
      { value: 'active', label: 'Active' },
      { value: 'expired', label: 'Expired' },
      { value: 'cancelled', label: 'Cancelled' },
    ]},
    { field: 'description', label: 'Full Description', type: 'textarea' },
  ],
  purchase_orders: [
    { field: 'display_name', label: 'Display Name', type: 'text', required: true },
    { field: 'supplier', label: 'Supplier', type: 'reference', referenceTable: 'sn_fin_supplier', required: true },
    { field: 'status', label: 'Status', type: 'select', options: [
      { value: 'draft', label: 'Draft' },
      { value: 'pending_approval', label: 'Pending Approval' },
      { value: 'approved', label: 'Approved' },
      { value: 'ordered', label: 'Ordered' },
      { value: 'received', label: 'Received' },
      { value: 'cancelled', label: 'Cancelled' },
    ]},
    { field: 'purchase_order_type', label: 'PO Type', type: 'select', options: [
      { value: 'standard', label: 'Standard' },
      { value: 'blanket', label: 'Blanket' },
      { value: 'contract', label: 'Contract' },
    ]},
    { field: 'total_amount', label: 'Total Amount', type: 'number' },
  ],
};

export function RecordFormModal({
  viewType,
  mode,
  record,
  onClose,
  onSuccess,
}: RecordFormModalProps) {
  const { settings } = useSettingsStore();
  const { addEntry, updateEntry } = useRequestLogStore();
  const { recordExecution, getWorkflow } = useWorkflowStore();
  const config = TABLE_VIEW_CONFIG[viewType];
  const fieldConfigs = FIELD_CONFIGS[viewType];

  const [formData, setFormData] = useState<Record<string, unknown>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [duplicateWarning, setDuplicateWarning] = useState<{
    field: string;
    matches: Record<string, unknown>[];
  } | null>(null);

  // Initialize form data
  useEffect(() => {
    if (mode === 'edit' && record) {
      const initialData: Record<string, unknown> = {};
      for (const fieldConfig of fieldConfigs) {
        const value = record[fieldConfig.field];
        if (typeof value === 'object' && value !== null) {
          const refValue = value as { value?: string };
          initialData[fieldConfig.field] = refValue.value || '';
        } else {
          initialData[fieldConfig.field] = value || '';
        }
      }
      setFormData(initialData);
    } else {
      // Set defaults for create mode
      const initialData: Record<string, unknown> = {};
      if (viewType === 'contracts') {
        initialData.contract_administrator = settings.defaults.contractAdministrator;
        initialData.approver = settings.defaults.approver;
        initialData.state = 'draft';
      }
      if (viewType === 'vendors') {
        initialData.vendor = 'true'; // Mark as vendor
        initialData.vendor_manager = settings.defaults.vendorManager;
      }
      setFormData(initialData);
    }
  }, [mode, record, viewType, fieldConfigs, settings.defaults]);

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

  // Check for duplicates
  const checkDuplicates = useCallback(async (field: string, value: string) => {
    if (!value || value.length < 3) return;

    const api = getApi();
    const queryField = field === 'name' ? 'nameLIKE' : `${field}LIKE`;

    try {
      const response = await api.get<Record<string, unknown>>(config.table, {
        sysparm_query: `${queryField}${value}`,
        sysparm_limit: 5,
        sysparm_display_value: 'all',
      });

      if (response.result && response.result.length > 0) {
        // Filter out current record in edit mode
        const matches = mode === 'edit'
          ? response.result.filter((r) => r.sys_id !== record?.sys_id)
          : response.result;

        if (matches.length > 0) {
          setDuplicateWarning({ field, matches });
        }
      }
    } catch (err) {
      console.error('Error checking duplicates:', err);
    }
  }, [getApi, config.table, mode, record]);

  // Save mutation
  const saveMutation = useMutation({
    mutationFn: async () => {
      const api = getApi();
      const startTime = Date.now();

      // Prepare data (remove empty fields)
      const submitData: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(formData)) {
        if (value !== '' && value !== null && value !== undefined) {
          submitData[key] = value;
        }
      }

      // Add vendor flag for vendor creation
      if (viewType === 'vendors' && mode === 'create') {
        submitData.vendor = 'true';
      }

      const method = mode === 'create' ? 'POST' : 'PATCH';
      const url = mode === 'create'
        ? `${settings.servicenow.instanceUrl}/api/now/table/${config.table}`
        : `${settings.servicenow.instanceUrl}/api/now/table/${config.table}/${record?.sys_id}`;

      const logId = addEntry({
        method,
        url,
        table: config.table,
        recordSysId: record?.sys_id as string | undefined,
        headers: {
          'Content-Type': 'application/json',
          'x-sn-apikey': settings.servicenow.apiKey,
        },
        body: submitData,
      });

      try {
        let response;
        if (mode === 'create') {
          response = await api.create(config.table, submitData);
        } else {
          response = await api.update(config.table, record?.sys_id as string, submitData);
        }

        const duration = Date.now() - startTime;
        updateEntry(logId, {
          responseStatus: 200,
          responseBody: response,
          duration,
        });

        const workflow = getWorkflow(method, config.table);
        if (workflow) {
          recordExecution(workflow.id, true);
        }

        return response;
      } catch (err: any) {
        const duration = Date.now() - startTime;
        updateEntry(logId, {
          responseStatus: err.response?.status || 500,
          error: err.message,
          duration,
        });

        const workflow = getWorkflow(method, config.table);
        if (workflow) {
          recordExecution(workflow.id, false);
        }

        throw err;
      }
    },
    onSuccess: () => {
      onSuccess();
    },
  });

  // Validate form
  const validateForm = useCallback(() => {
    const newErrors: Record<string, string> = {};

    for (const fieldConfig of fieldConfigs) {
      if (fieldConfig.required && !formData[fieldConfig.field]) {
        newErrors[fieldConfig.field] = `${fieldConfig.label} is required`;
      }
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }, [formData, fieldConfigs]);

  // Handle submit
  const handleSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    if (validateForm()) {
      saveMutation.mutate();
    }
  }, [validateForm, saveMutation]);

  // Handle field change
  const handleFieldChange = useCallback((field: string, value: unknown) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    setErrors((prev) => ({ ...prev, [field]: '' }));
  }, []);

  // Handle field blur for duplicate checking
  const handleFieldBlur = useCallback((field: string) => {
    if (['name', 'display_name', 'short_description'].includes(field)) {
      const value = formData[field] as string;
      if (value) {
        checkDuplicates(field, value);
      }
    }
  }, [formData, checkDuplicates]);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-2xl w-[700px] max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">
            {mode === 'create' ? `New ${config.label.slice(0, -1)}` : `Edit ${config.label.slice(0, -1)}`}
          </h2>
          <button
            onClick={onClose}
            className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Duplicate Warning */}
        {duplicateWarning && (
          <div className="mx-4 mt-4 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
            <div className="flex items-start gap-2">
              <AlertTriangle className="w-5 h-5 text-yellow-500 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-yellow-700">
                  Potential duplicates found
                </p>
                <p className="text-sm text-yellow-600 mt-1">
                  Similar records exist with matching {duplicateWarning.field}:
                </p>
                <ul className="mt-2 space-y-1">
                  {duplicateWarning.matches.slice(0, 3).map((match, index) => (
                    <li key={index} className="text-sm text-yellow-700">
                      {(match.name || match.display_name || match.number) as string} ({match.sys_id as string})
                    </li>
                  ))}
                </ul>
                <button
                  onClick={() => setDuplicateWarning(null)}
                  className="mt-2 text-sm text-yellow-700 hover:text-yellow-800 underline"
                >
                  Dismiss
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-4">
          <div className="grid grid-cols-2 gap-4">
            {fieldConfigs.map((fieldConfig) => (
              <div
                key={fieldConfig.field}
                className={fieldConfig.type === 'textarea' ? 'col-span-2' : ''}
              >
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {fieldConfig.label}
                  {fieldConfig.required && <span className="text-red-500 ml-1">*</span>}
                </label>

                {fieldConfig.type === 'text' && (
                  <input
                    type="text"
                    value={(formData[fieldConfig.field] as string) || ''}
                    onChange={(e) => handleFieldChange(fieldConfig.field, e.target.value)}
                    onBlur={() => handleFieldBlur(fieldConfig.field)}
                    className={clsx(
                      'w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500',
                      errors[fieldConfig.field] ? 'border-red-300' : 'border-gray-300'
                    )}
                  />
                )}

                {fieldConfig.type === 'textarea' && (
                  <textarea
                    value={(formData[fieldConfig.field] as string) || ''}
                    onChange={(e) => handleFieldChange(fieldConfig.field, e.target.value)}
                    rows={3}
                    className={clsx(
                      'w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500',
                      errors[fieldConfig.field] ? 'border-red-300' : 'border-gray-300'
                    )}
                  />
                )}

                {fieldConfig.type === 'select' && (
                  <select
                    value={(formData[fieldConfig.field] as string) || ''}
                    onChange={(e) => handleFieldChange(fieldConfig.field, e.target.value)}
                    className={clsx(
                      'w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500',
                      errors[fieldConfig.field] ? 'border-red-300' : 'border-gray-300'
                    )}
                  >
                    <option value="">Select...</option>
                    {fieldConfig.options?.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                )}

                {fieldConfig.type === 'date' && (
                  <input
                    type="date"
                    value={(formData[fieldConfig.field] as string) || ''}
                    onChange={(e) => handleFieldChange(fieldConfig.field, e.target.value)}
                    className={clsx(
                      'w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500',
                      errors[fieldConfig.field] ? 'border-red-300' : 'border-gray-300'
                    )}
                  />
                )}

                {fieldConfig.type === 'number' && (
                  <input
                    type="number"
                    value={(formData[fieldConfig.field] as string) || ''}
                    onChange={(e) => handleFieldChange(fieldConfig.field, e.target.value)}
                    className={clsx(
                      'w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500',
                      errors[fieldConfig.field] ? 'border-red-300' : 'border-gray-300'
                    )}
                  />
                )}

                {fieldConfig.type === 'boolean' && (
                  <div className="flex items-center gap-2 mt-2">
                    <input
                      type="checkbox"
                      checked={formData[fieldConfig.field] === 'true' || formData[fieldConfig.field] === true}
                      onChange={(e) => handleFieldChange(fieldConfig.field, e.target.checked ? 'true' : 'false')}
                      className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    <span className="text-sm text-gray-600">Yes</span>
                  </div>
                )}

                {fieldConfig.type === 'reference' && (
                  <ReferenceField
                    value={(formData[fieldConfig.field] as string) || ''}
                    onChange={(value) => handleFieldChange(fieldConfig.field, value)}
                    referenceTable={fieldConfig.referenceTable!}
                    hasError={!!errors[fieldConfig.field]}
                  />
                )}

                {errors[fieldConfig.field] && (
                  <p className="mt-1 text-sm text-red-500">{errors[fieldConfig.field]}</p>
                )}
              </div>
            ))}
          </div>
        </form>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 p-4 border-t border-gray-200 bg-gray-50">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={saveMutation.isPending}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-50"
          >
            {saveMutation.isPending ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <Save className="w-4 h-4" />
                {mode === 'create' ? 'Create' : 'Save Changes'}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

// Reference Field Component
function ReferenceField({
  value,
  onChange,
  referenceTable,
  hasError,
}: {
  value: string;
  onChange: (value: string) => void;
  referenceTable: string;
  hasError: boolean;
}) {
  const { settings } = useSettingsStore();
  const [searchQuery, setSearchQuery] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [selectedDisplay, setSelectedDisplay] = useState('');

  // Search reference records
  const { data: searchResults, isLoading } = useQuery({
    queryKey: ['reference', referenceTable, searchQuery],
    queryFn: async () => {
      if (!searchQuery || searchQuery.length < 2) return [];

      const api = getServiceNowAPI(settings.servicenow.instanceUrl, settings.servicenow.apiKey);
      let query = `nameLIKE${searchQuery}`;

      // Add vendor filter for core_company
      if (referenceTable === 'core_company') {
        query = `vendor=true^${query}`;
      }

      const response = await api.get<Record<string, unknown>>(referenceTable, {
        sysparm_query: query,
        sysparm_limit: 10,
        sysparm_display_value: 'all',
      });
      return response.result || [];
    },
    enabled: isOpen && searchQuery.length >= 2 && !!settings.servicenow.apiKey,
  });

  const handleSelect = (record: Record<string, unknown>) => {
    onChange(record.sys_id as string);
    setSelectedDisplay((record.name || record.display_name || record.number) as string);
    setIsOpen(false);
    setSearchQuery('');
  };

  return (
    <div className="relative">
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={isOpen ? searchQuery : selectedDisplay || value}
          onChange={(e) => {
            setSearchQuery(e.target.value);
            setIsOpen(true);
          }}
          onFocus={() => setIsOpen(true)}
          placeholder="Search..."
          className={clsx(
            'flex-1 px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500',
            hasError ? 'border-red-300' : 'border-gray-300'
          )}
        />
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          className="p-2 text-gray-400 hover:text-gray-600 border border-gray-300 rounded-lg"
        >
          <Search className="w-4 h-4" />
        </button>
      </div>

      {isOpen && (
        <div className="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
          {isLoading ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="w-5 h-5 text-blue-500 animate-spin" />
            </div>
          ) : searchResults && searchResults.length > 0 ? (
            searchResults.map((record: Record<string, unknown>) => (
              <button
                key={record.sys_id as string}
                type="button"
                onClick={() => handleSelect(record)}
                className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-gray-50"
              >
                <Link2 className="w-4 h-4 text-gray-400" />
                <span className="text-sm text-gray-700">
                  {(record.name || record.display_name || record.number) as string}
                </span>
                {value === record.sys_id && (
                  <Check className="w-4 h-4 text-green-500 ml-auto" />
                )}
              </button>
            ))
          ) : searchQuery.length >= 2 ? (
            <div className="px-3 py-2 text-sm text-gray-500">
              No results found
            </div>
          ) : (
            <div className="px-3 py-2 text-sm text-gray-500">
              Type at least 2 characters to search
            </div>
          )}
        </div>
      )}
    </div>
  );
}
