import { useState, useCallback, useEffect, type FormEvent } from 'react';
import {
  X,
  Save,
  Loader2,
  DollarSign,
  Calculator,
} from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useSettingsStore } from '../../stores/settingsStore';
import { useRequestLogStore } from '../../stores/requestLogStore';
import { getServiceNowAPI, initServiceNowAPI } from '../../services/servicenow';

interface POLineFormProps {
  purchaseOrderId: string;
  purchaseOrderNumber?: string;
  mode: 'create' | 'edit';
  existingLine?: Record<string, unknown>;
  onClose: () => void;
  onSuccess: () => void;
}

export function POLineForm({
  purchaseOrderId,
  purchaseOrderNumber,
  mode,
  existingLine,
  onClose,
  onSuccess,
}: POLineFormProps) {
  const { settings } = useSettingsStore();
  const { addEntry, updateEntry } = useRequestLogStore();
  const queryClient = useQueryClient();

  const [formData, setFormData] = useState({
    product_name: '',
    short_description: '',
    purchased_quantity: '1',
    unit_price_amount: '',
    currency_code: settings.defaults.currency || 'USD',
  });

  const [calculatedTotal, setCalculatedTotal] = useState('0.00');

  // Initialize form data for edit mode
  useEffect(() => {
    if (mode === 'edit' && existingLine) {
      setFormData({
        product_name: (existingLine.product_name as string) || '',
        short_description: (existingLine.short_description as string) || '',
        purchased_quantity: (existingLine.purchased_quantity as string) || '1',
        unit_price_amount: '', // Currency instances need special handling
        currency_code: settings.defaults.currency || 'USD',
      });
    }
  }, [mode, existingLine, settings.defaults.currency]);

  // Calculate total when quantity or unit price changes
  useEffect(() => {
    const quantity = parseFloat(formData.purchased_quantity) || 0;
    const unitPrice = parseFloat(formData.unit_price_amount) || 0;
    setCalculatedTotal((quantity * unitPrice).toFixed(2));
  }, [formData.purchased_quantity, formData.unit_price_amount]);

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

  // Create PO Line mutation
  const createMutation = useMutation({
    mutationFn: async () => {
      const api = getApi();
      const startTime = Date.now();

      // Step 1: Create currency instance for unit_price
      const unitPriceLogId = addEntry({
        method: 'POST',
        url: `${settings.servicenow.instanceUrl}/api/now/table/fx_currency2_instance`,
        table: 'fx_currency2_instance',
        headers: {
          'Content-Type': 'application/json',
          'x-sn-apikey': settings.servicenow.apiKey,
        },
        body: {
          amount: formData.unit_price_amount,
          currency: formData.currency_code,
          field: 'unit_price',
        },
      });

      let unitPriceSysId: string;
      try {
        const response = await api.create('fx_currency2_instance', {
          amount: formData.unit_price_amount,
          currency: formData.currency_code,
          field: 'unit_price',
        });
        unitPriceSysId = (response.result as any).sys_id;
        updateEntry(unitPriceLogId, {
          responseStatus: 201,
          responseBody: response,
          duration: Date.now() - startTime,
        });
      } catch (err: any) {
        updateEntry(unitPriceLogId, {
          responseStatus: err.response?.status || 500,
          error: err.message,
          duration: Date.now() - startTime,
        });
        throw err;
      }

      // Step 2: Create currency instance for total_line_amount
      const totalAmountLogId = addEntry({
        method: 'POST',
        url: `${settings.servicenow.instanceUrl}/api/now/table/fx_currency2_instance`,
        table: 'fx_currency2_instance',
        headers: {
          'Content-Type': 'application/json',
          'x-sn-apikey': settings.servicenow.apiKey,
        },
        body: {
          amount: calculatedTotal,
          currency: formData.currency_code,
          field: 'total_line_amount',
        },
      });

      let totalAmountSysId: string;
      try {
        const response = await api.create('fx_currency2_instance', {
          amount: calculatedTotal,
          currency: formData.currency_code,
          field: 'total_line_amount',
        });
        totalAmountSysId = (response.result as any).sys_id;
        updateEntry(totalAmountLogId, {
          responseStatus: 201,
          responseBody: response,
          duration: Date.now() - startTime,
        });
      } catch (err: any) {
        updateEntry(totalAmountLogId, {
          responseStatus: err.response?.status || 500,
          error: err.message,
          duration: Date.now() - startTime,
        });
        throw err;
      }

      // Step 3: Create the PO Line with currency instance references
      const poLineLogId = addEntry({
        method: 'POST',
        url: `${settings.servicenow.instanceUrl}/api/now/table/sn_shop_purchase_order_line`,
        table: 'sn_shop_purchase_order_line',
        headers: {
          'Content-Type': 'application/json',
          'x-sn-apikey': settings.servicenow.apiKey,
        },
        body: {
          purchase_order: purchaseOrderId,
          product_name: formData.product_name,
          short_description: formData.short_description,
          purchased_quantity: formData.purchased_quantity,
          unit_price: unitPriceSysId,
          total_line_amount: totalAmountSysId,
        },
      });

      try {
        const response = await api.create('sn_shop_purchase_order_line', {
          purchase_order: purchaseOrderId,
          product_name: formData.product_name,
          short_description: formData.short_description,
          purchased_quantity: formData.purchased_quantity,
          unit_price: unitPriceSysId,
          total_line_amount: totalAmountSysId,
        });
        updateEntry(poLineLogId, {
          responseStatus: 201,
          responseBody: response,
          duration: Date.now() - startTime,
        });
        return response;
      } catch (err: any) {
        updateEntry(poLineLogId, {
          responseStatus: err.response?.status || 500,
          error: err.message,
          duration: Date.now() - startTime,
        });
        throw err;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['table'] });
      onSuccess();
    },
  });

  const handleFieldChange = (field: string, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    createMutation.mutate();
  };

  const formatCurrency = (amount: string, currency: string) => {
    const num = parseFloat(amount) || 0;
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency,
    }).format(num);
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-2xl w-[600px] max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-green-100 rounded-lg">
              <DollarSign className="w-5 h-5 text-green-600" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-gray-900">
                {mode === 'create' ? 'Add PO Line' : 'Edit PO Line'}
              </h2>
              {purchaseOrderNumber && (
                <p className="text-sm text-gray-500">
                  Purchase Order: {purchaseOrderNumber}
                </p>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Product Name */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Product Name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={formData.product_name}
              onChange={(e) => handleFieldChange('product_name', e.target.value)}
              placeholder="Enter product name"
              required
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-green-500 focus:border-green-500"
            />
          </div>

          {/* Short Description */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Description
            </label>
            <textarea
              value={formData.short_description}
              onChange={(e) => handleFieldChange('short_description', e.target.value)}
              placeholder="Enter description"
              rows={2}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-green-500 focus:border-green-500"
            />
          </div>

          {/* Quantity and Price Row */}
          <div className="grid grid-cols-3 gap-4">
            {/* Quantity */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Quantity <span className="text-red-500">*</span>
              </label>
              <input
                type="number"
                min="1"
                value={formData.purchased_quantity}
                onChange={(e) => handleFieldChange('purchased_quantity', e.target.value)}
                required
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-green-500 focus:border-green-500"
              />
            </div>

            {/* Unit Price */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Unit Price <span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={formData.unit_price_amount}
                  onChange={(e) => handleFieldChange('unit_price_amount', e.target.value)}
                  placeholder="0.00"
                  required
                  className="w-full pl-8 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-green-500 focus:border-green-500"
                />
              </div>
            </div>

            {/* Currency */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Currency
              </label>
              <select
                value={formData.currency_code}
                onChange={(e) => handleFieldChange('currency_code', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-green-500 focus:border-green-500"
              >
                <option value="USD">USD</option>
                <option value="EUR">EUR</option>
                <option value="GBP">GBP</option>
                <option value="CAD">CAD</option>
                <option value="AUD">AUD</option>
              </select>
            </div>
          </div>

          {/* Calculated Total */}
          <div className="p-4 bg-gray-50 rounded-lg">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Calculator className="w-5 h-5 text-gray-400" />
                <span className="text-sm font-medium text-gray-700">Total Line Amount</span>
              </div>
              <span className="text-lg font-bold text-gray-900">
                {formatCurrency(calculatedTotal, formData.currency_code)}
              </span>
            </div>
            <p className="text-xs text-gray-500 mt-1">
              {formData.purchased_quantity} x {formatCurrency(formData.unit_price_amount || '0', formData.currency_code)}
            </p>
          </div>

          {/* Currency Instance Info */}
          <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
            <p className="text-sm text-blue-700">
              <strong>Note:</strong> Currency instances will be automatically created in ServiceNow
              for both the unit price and total line amount fields.
            </p>
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
            disabled={
              createMutation.isPending ||
              !formData.product_name ||
              !formData.unit_price_amount ||
              !formData.purchased_quantity
            }
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-green-600 hover:bg-green-700 rounded-lg disabled:opacity-50"
          >
            {createMutation.isPending ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Creating...
              </>
            ) : (
              <>
                <Save className="w-4 h-4" />
                Create Line Item
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
