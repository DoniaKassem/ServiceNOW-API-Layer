import { useState } from 'react';
import {
  Edit3,
  Save,
  X,
  Plus,
  Search,
  Link,
  RefreshCw,
  CheckCircle,
  AlertCircle,
} from 'lucide-react';
import { clsx } from 'clsx';
import { useSessionStore } from '../../stores/sessionStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { initServiceNowAPI } from '../../services/servicenow';
import type { ExtractedData } from '../../types';
import { TABLE_NAMES } from '../../types';

interface MatchCandidate {
  sys_id: string;
  name: string;
  confidence: number;
  reason: string;
  supplier_sys_id?: string; // Supplier sys_id from vendor record
}

export function ExtractionEditor() {
  const {
    getCurrentSession,
    updateExtractedData,
    addRequest,
    addAuditEntry,
  } = useSessionStore();
  const { settings } = useSettingsStore();

  const session = getCurrentSession();
  const [editingField, setEditingField] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [searchingVendor, setSearchingVendor] = useState(false);
  const [vendorMatches, setVendorMatches] = useState<MatchCandidate[]>([]);
  const [selectedVendorMatch, setSelectedVendorMatch] = useState<string | null>(null);
  const [generationResult, setGenerationResult] = useState<{ success: boolean; count: number } | null>(null);

  if (!session || !session.extractedData) {
    return (
      <div className="p-6">
        <div className="bg-white rounded-lg border border-gray-200 p-8 text-center">
          <Edit3 className="w-12 h-12 mx-auto text-gray-300 mb-4" />
          <p className="text-gray-500">No extracted data to edit</p>
          <p className="text-sm text-gray-400 mt-2">
            Upload and process a document first
          </p>
        </div>
      </div>
    );
  }

  const data = session.extractedData;

  const handleStartEdit = (field: string, currentValue: string) => {
    setEditingField(field);
    setEditValue(currentValue || '');
  };

  const handleSaveEdit = (section: keyof ExtractedData, field: string) => {
    const sectionData = data[section];
    if (sectionData && typeof sectionData === 'object' && !Array.isArray(sectionData)) {
      const oldValue = (sectionData as Record<string, unknown>)[field];
      const newData = {
        ...data,
        [section]: {
          ...sectionData,
          [field]: editValue,
        },
      };
      updateExtractedData(session.id, newData);
      addAuditEntry(
        session.id,
        'FIELD_EDITED',
        `Edited ${section}.${field}`,
        oldValue,
        editValue
      );
    }
    setEditingField(null);
    setEditValue('');
  };

  const handleCancelEdit = () => {
    setEditingField(null);
    setEditValue('');
  };

  const handleSearchVendor = async () => {
    if (!settings.servicenow.apiKey || !data.vendor?.name) return;

    setSearchingVendor(true);
    setVendorMatches([]);

    try {
      const api = initServiceNowAPI(
        settings.servicenow.instanceUrl,
        settings.servicenow.apiKey
      );
      const result = await api.searchVendors(data.vendor.name);

      const matches: MatchCandidate[] = result.result.map((v) => {
        // Extract supplier sys_id from reference field
        // With sysparm_display_value: 'all', reference fields come as { link, value, display_value }
        let supplierSysId: string | undefined;
        if (v.supplier) {
          if (typeof v.supplier === 'object' && v.supplier !== null && 'value' in v.supplier) {
            // Reference field with display_value format: { link, value, display_value }
            supplierSysId = (v.supplier as { value: string }).value;
          } else if (typeof v.supplier === 'string' && v.supplier.length > 0) {
            supplierSysId = v.supplier;
          }
        }

        console.log('Vendor supplier data:', v.supplier, '-> extracted sys_id:', supplierSysId);

        // Handle sysparm_display_value: 'all' response format where fields are objects
        // with { display_value: string, value: string } structure
        const vendorName = typeof v.name === 'object' && v.name !== null && 'display_value' in v.name
          ? (v.name as { display_value: string }).display_value
          : String(v.name || '');

        const vendorSysId = typeof v.sys_id === 'object' && v.sys_id !== null && 'value' in v.sys_id
          ? (v.sys_id as { value: string }).value
          : String(v.sys_id || '');

        const searchName = data.vendor?.name?.toLowerCase() || '';
        const matchName = vendorName.toLowerCase();

        return {
          sys_id: vendorSysId,
          name: vendorName,
          confidence: matchName === searchName ? 95 : 70,
          reason: matchName === searchName ? 'Exact name match' : 'Partial name match',
          supplier_sys_id: supplierSysId,
        };
      });

      setVendorMatches(matches);
    } catch (error) {
      console.error('Vendor search error:', error);
    } finally {
      setSearchingVendor(false);
    }
  };

  const handleLinkVendor = (sysId: string, supplierSysId?: string) => {
    setSelectedVendorMatch(sysId);
    const newData = {
      ...data,
      vendor: {
        ...data.vendor,
        sys_id: sysId,
      },
      // Store the linked supplier sys_id for use in contract generation
      linkedSupplierSysId: supplierSysId,
    };
    updateExtractedData(session.id, newData);
    addAuditEntry(
      session.id,
      'VENDOR_LINKED',
      `Linked to existing vendor: ${sysId}${supplierSysId ? `, supplier: ${supplierSysId}` : ''}`
    );
  };

  const generateRequests = () => {
    let requestCount = 0;

    // Generate vendor request
    if (data.vendor && !data.vendor.sys_id) {
      addRequest(session.id, {
        entityType: 'vendor',
        method: 'POST',
        url: `${settings.servicenow.instanceUrl}/api/now/table/${TABLE_NAMES.vendor}`,
        headers: { 'x-sn-apikey': settings.servicenow.apiKey },
        body: {
          name: data.vendor.name,
          website: data.vendor.website,
          street: data.vendor.street,
          city: data.vendor.city,
          state: data.vendor.state,
          country: data.vendor.country,
          vendor_type: data.vendor.vendor_type,
          vendor_manager: settings.defaults.vendorManager,
          vendor: 'true',
        },
      });
      requestCount++;
    }

    // Generate supplier request (only if no linked supplier from vendor)
    if (data.supplier && !data.linkedSupplierSysId) {
      addRequest(session.id, {
        entityType: 'supplier',
        method: 'POST',
        url: `${settings.servicenow.instanceUrl}/api/now/table/${TABLE_NAMES.supplier}`,
        headers: { 'x-sn-apikey': settings.servicenow.apiKey },
        body: {
          name: data.supplier.name,
          legal_name: data.supplier.legal_name || data.supplier.name,
          u_vendor: data.vendor?.sys_id || '{{vendor.sys_id}}',
          web_site: data.supplier.web_site,
          street: data.supplier.street,
          city: data.supplier.city,
          state: data.supplier.state,
          country: data.supplier.country,
        },
        dependsOn: data.vendor?.sys_id ? undefined : ['vendor'],
      });
      requestCount++;
    }

    // Generate contract request
    if (data.contract) {
      // Determine supplier value: use linked supplier from vendor, or placeholder
      const supplierValue = data.linkedSupplierSysId || '{{supplier.sys_id}}';
      const needsSupplierDependency = !data.linkedSupplierSysId;

      addRequest(session.id, {
        entityType: 'contract',
        method: 'POST',
        url: `${settings.servicenow.instanceUrl}/api/now/table/${TABLE_NAMES.contract}`,
        headers: { 'x-sn-apikey': settings.servicenow.apiKey },
        body: {
          short_description: data.contract.short_description,
          description: data.contract.description,
          vendor: data.vendor?.sys_id || '{{vendor.sys_id}}',
          supplier: supplierValue,
          starts: data.contract.starts,
          ends: data.contract.ends,
          payment_amount: data.contract.payment_amount,
          payment_schedule: data.contract.payment_schedule,
          invoice_payment_terms: data.contract.invoice_payment_terms,
          u_payment_method: data.contract.u_payment_method,
          renewable: data.contract.renewable,
          contract_administrator: settings.defaults.contractAdministrator || 'Ahmed Donia',
          // Additional fields for contract identification
          contract_model: data.contract.contract_model || 'Subscription',
          approver: settings.defaults.approver || 'Ahmed Donia',
          vendor_contract: data.contract.vendor_contract || 'Identified by AI',
        },
        dependsOn: needsSupplierDependency ? ['supplier'] : undefined,
      });
      requestCount++;
    }

    // Generate expense lines
    if (data.expenseLines && data.expenseLines.length > 0) {
      data.expenseLines.forEach((line) => {
        addRequest(session.id, {
          entityType: 'expense_line',
          method: 'POST',
          url: `${settings.servicenow.instanceUrl}/api/now/table/${TABLE_NAMES.expense_line}`,
          headers: { 'x-sn-apikey': settings.servicenow.apiKey },
          body: {
            amount: line.amount,
            short_description: line.short_description,
            contract: '{{contract.sys_id}}',
          },
          dependsOn: ['contract'],
        });
        requestCount++;
      });
    }

    // Generate purchase order request
    if (data.purchaseOrder) {
      addRequest(session.id, {
        entityType: 'purchase_order',
        method: 'POST',
        url: `${settings.servicenow.instanceUrl}/api/now/table/${TABLE_NAMES.purchase_order}`,
        headers: { 'x-sn-apikey': settings.servicenow.apiKey },
        body: {
          display_name: data.purchaseOrder.display_name,
          supplier: '{{supplier.sys_id}}',
          total_amount: data.purchaseOrder.total_amount,
          status: data.purchaseOrder.status || 'draft',
          purchase_order_type: data.purchaseOrder.purchase_order_type,
          created: data.purchaseOrder.created,
        },
        dependsOn: ['supplier'],
      });
      requestCount++;
    }

    // Generate PO lines
    if (data.purchaseOrderLines && data.purchaseOrderLines.length > 0) {
      data.purchaseOrderLines.forEach((line) => {
        addRequest(session.id, {
          entityType: 'purchase_order_line',
          method: 'POST',
          url: `${settings.servicenow.instanceUrl}/api/now/table/${TABLE_NAMES.purchase_order_line}`,
          headers: { 'x-sn-apikey': settings.servicenow.apiKey },
          body: {
            purchase_order: '{{purchase_order.sys_id}}',
            product_name: line.product_name,
            short_description: line.short_description,
            purchased_quantity: line.purchased_quantity,
            unit_price: line.unit_price,
            total_line_amount: line.total_line_amount,
          },
          dependsOn: ['purchase_order'],
        });
        requestCount++;
      });
    }

    if (requestCount > 0) {
      addAuditEntry(session.id, 'REQUESTS_GENERATED', `Generated ${requestCount} API requests from extracted data`);
      setGenerationResult({ success: true, count: requestCount });
    } else {
      setGenerationResult({ success: false, count: 0 });
    }

    // Clear the result after 5 seconds
    setTimeout(() => setGenerationResult(null), 5000);
  };

  const getConfidenceColor = (confidence: number) => {
    if (confidence >= 80) return 'text-green-600 bg-green-50 border-green-200';
    if (confidence >= 50) return 'text-yellow-600 bg-yellow-50 border-yellow-200';
    return 'text-red-600 bg-red-50 border-red-200';
  };

  const renderEntityField = (
    label: string,
    value: string | undefined,
    section: keyof ExtractedData,
    field: string,
    confidence?: number
  ) => {
    const fieldKey = `${section}.${field}`;
    const isEditing = editingField === fieldKey;

    return (
      <div className="flex items-start justify-between py-2 border-b border-gray-100 last:border-0">
        <div className="flex-1">
          <label className="text-sm text-gray-500">{label}</label>
          {isEditing ? (
            <div className="flex items-center gap-2 mt-1">
              <input
                type="text"
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                className="flex-1 px-2 py-1 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-blue-500"
                autoFocus
              />
              <button
                onClick={() => handleSaveEdit(section, field)}
                className="p-1 text-green-600 hover:bg-green-50 rounded"
              >
                <Save className="w-4 h-4" />
              </button>
              <button
                onClick={handleCancelEdit}
                className="p-1 text-gray-600 hover:bg-gray-50 rounded"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2 mt-1">
              <p className="text-sm text-gray-900">{value || '-'}</p>
              <button
                onClick={() => handleStartEdit(fieldKey, value || '')}
                className="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-50 rounded opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <Edit3 className="w-3 h-3" />
              </button>
            </div>
          )}
        </div>
        {confidence !== undefined && (
          <span
            className={clsx(
              'px-2 py-0.5 text-xs rounded-full border',
              getConfidenceColor(confidence)
            )}
          >
            {confidence}%
          </span>
        )}
      </div>
    );
  };

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Edit3 className="w-8 h-8 text-gray-700" />
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Review Extracted Data</h1>
            <p className="text-gray-500">Edit fields and generate API requests</p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <button
            onClick={generateRequests}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            <Plus className="w-4 h-4" />
            Generate Requests
          </button>

          {generationResult && generationResult.success && (
            <div className="flex items-center gap-2 text-green-600">
              <CheckCircle className="w-5 h-5" />
              <span className="text-sm font-medium">
                Generated {generationResult.count} requests! Go to Request Queue to review.
              </span>
            </div>
          )}

          {generationResult && !generationResult.success && (
            <div className="flex items-center gap-2 text-yellow-600">
              <AlertCircle className="w-5 h-5" />
              <span className="text-sm font-medium">
                No data to generate requests from. Upload and process a document first.
              </span>
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-6">
        {/* Vendor Section */}
        {data.vendor && (
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-medium text-gray-900">Vendor</h3>
              {data.vendor.sys_id ? (
                <span className="flex items-center gap-1 text-xs text-green-600">
                  <Link className="w-3 h-3" />
                  Linked
                </span>
              ) : (
                <button
                  onClick={handleSearchVendor}
                  disabled={searchingVendor}
                  className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700"
                >
                  {searchingVendor ? (
                    <RefreshCw className="w-3 h-3 animate-spin" />
                  ) : (
                    <Search className="w-3 h-3" />
                  )}
                  Find Match
                </button>
              )}
            </div>

            <div className="group space-y-1">
              {renderEntityField('Name', data.vendor.name, 'vendor', 'name')}
              {renderEntityField('Website', data.vendor.website, 'vendor', 'website')}
              {renderEntityField('Street', data.vendor.street, 'vendor', 'street')}
              {renderEntityField('City', data.vendor.city, 'vendor', 'city')}
              {renderEntityField('State', data.vendor.state, 'vendor', 'state')}
              {renderEntityField('Country', data.vendor.country, 'vendor', 'country')}
              {renderEntityField('Type', data.vendor.vendor_type, 'vendor', 'vendor_type')}
            </div>

            {/* Vendor Matches */}
            {vendorMatches.length > 0 && (
              <div className="mt-4 pt-4 border-t border-gray-200">
                <h4 className="text-sm font-medium text-gray-700 mb-2">
                  Existing Vendor Matches
                </h4>
                <div className="space-y-2">
                  {vendorMatches.map((match) => (
                    <div
                      key={match.sys_id}
                      className={clsx(
                        'p-2 rounded-lg border cursor-pointer transition-colors',
                        selectedVendorMatch === match.sys_id
                          ? 'border-blue-500 bg-blue-50'
                          : 'border-gray-200 hover:border-gray-300'
                      )}
                      onClick={() => handleLinkVendor(match.sys_id, match.supplier_sys_id)}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-gray-900">
                          {match.name}
                        </span>
                        <span
                          className={clsx(
                            'px-2 py-0.5 text-xs rounded-full',
                            getConfidenceColor(match.confidence)
                          )}
                        >
                          {match.confidence}%
                        </span>
                      </div>
                      <p className="text-xs text-gray-500 mt-1">{match.reason}</p>
                      {match.supplier_sys_id && (
                        <p className="text-xs text-green-600 mt-1">Has linked supplier</p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Supplier Section */}
        {data.supplier && (
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <h3 className="font-medium text-gray-900 mb-4">Supplier</h3>
            <div className="group space-y-1">
              {renderEntityField('Name', data.supplier.name, 'supplier', 'name')}
              {renderEntityField(
                'Legal Name',
                data.supplier.legal_name,
                'supplier',
                'legal_name'
              )}
              {renderEntityField('Website', data.supplier.web_site, 'supplier', 'web_site')}
              {renderEntityField('Street', data.supplier.street, 'supplier', 'street')}
              {renderEntityField('City', data.supplier.city, 'supplier', 'city')}
              {renderEntityField('State', data.supplier.state, 'supplier', 'state')}
              {renderEntityField('Country', data.supplier.country, 'supplier', 'country')}
            </div>
          </div>
        )}

        {/* Contract Section */}
        {data.contract && (
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <h3 className="font-medium text-gray-900 mb-4">Contract</h3>
            <div className="group space-y-1">
              {renderEntityField(
                'Description',
                data.contract.short_description,
                'contract',
                'short_description'
              )}
              {renderEntityField('Start Date', data.contract.starts, 'contract', 'starts')}
              {renderEntityField('End Date', data.contract.ends, 'contract', 'ends')}
              {renderEntityField(
                'Payment Amount',
                data.contract.payment_amount,
                'contract',
                'payment_amount'
              )}
              {renderEntityField(
                'Payment Schedule',
                data.contract.payment_schedule,
                'contract',
                'payment_schedule'
              )}
              {renderEntityField(
                'Payment Terms',
                data.contract.invoice_payment_terms,
                'contract',
                'invoice_payment_terms'
              )}
              {renderEntityField(
                'Renewable',
                data.contract.renewable,
                'contract',
                'renewable'
              )}
            </div>
          </div>
        )}

        {/* Purchase Order Section */}
        {data.purchaseOrder && (
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <h3 className="font-medium text-gray-900 mb-4">Purchase Order</h3>
            <div className="group space-y-1">
              {renderEntityField(
                'Name',
                data.purchaseOrder.display_name,
                'purchaseOrder',
                'display_name'
              )}
              {renderEntityField(
                'Total Amount',
                data.purchaseOrder.total_amount,
                'purchaseOrder',
                'total_amount'
              )}
              {renderEntityField('Status', data.purchaseOrder.status, 'purchaseOrder', 'status')}
              {renderEntityField(
                'Type',
                data.purchaseOrder.purchase_order_type,
                'purchaseOrder',
                'purchase_order_type'
              )}
              {renderEntityField('Date', data.purchaseOrder.created, 'purchaseOrder', 'created')}
            </div>
          </div>
        )}

        {/* Expense Lines */}
        {data.expenseLines && data.expenseLines.length > 0 && (
          <div className="bg-white rounded-lg border border-gray-200 p-4 col-span-2">
            <h3 className="font-medium text-gray-900 mb-4">
              Expense Lines ({data.expenseLines.length})
            </h3>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left py-2 text-gray-500 font-medium">#</th>
                  <th className="text-left py-2 text-gray-500 font-medium">Description</th>
                  <th className="text-right py-2 text-gray-500 font-medium">Amount</th>
                </tr>
              </thead>
              <tbody>
                {data.expenseLines.map((line, index) => (
                  <tr key={index} className="border-b border-gray-100">
                    <td className="py-2 text-gray-400">{index + 1}</td>
                    <td className="py-2 text-gray-900">{line.short_description || '-'}</td>
                    <td className="py-2 text-gray-900 text-right">{line.amount || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* PO Lines */}
        {data.purchaseOrderLines && data.purchaseOrderLines.length > 0 && (
          <div className="bg-white rounded-lg border border-gray-200 p-4 col-span-2">
            <h3 className="font-medium text-gray-900 mb-4">
              PO Lines ({data.purchaseOrderLines.length})
            </h3>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left py-2 text-gray-500 font-medium">#</th>
                  <th className="text-left py-2 text-gray-500 font-medium">Product</th>
                  <th className="text-right py-2 text-gray-500 font-medium">Qty</th>
                  <th className="text-right py-2 text-gray-500 font-medium">Unit Price</th>
                  <th className="text-right py-2 text-gray-500 font-medium">Total</th>
                </tr>
              </thead>
              <tbody>
                {data.purchaseOrderLines.map((line, index) => (
                  <tr key={index} className="border-b border-gray-100">
                    <td className="py-2 text-gray-400">{index + 1}</td>
                    <td className="py-2 text-gray-900">{line.product_name || '-'}</td>
                    <td className="py-2 text-gray-900 text-right">
                      {line.purchased_quantity || '-'}
                    </td>
                    <td className="py-2 text-gray-900 text-right">{line.unit_price || '-'}</td>
                    <td className="py-2 text-gray-900 text-right">
                      {line.total_line_amount || '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
