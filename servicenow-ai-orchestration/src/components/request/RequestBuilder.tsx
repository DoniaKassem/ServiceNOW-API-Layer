import { useState } from 'react';
import { Send, ChevronDown, ChevronRight, Copy, Play } from 'lucide-react';
import { Light as SyntaxHighlighter } from 'react-syntax-highlighter';
import json from 'react-syntax-highlighter/dist/esm/languages/hljs/json';
import { atomOneDark } from 'react-syntax-highlighter/dist/esm/styles/hljs';
import { clsx } from 'clsx';
import { useSettingsStore } from '../../stores/settingsStore';
import { initServiceNowAPI } from '../../services/servicenow';
import type { EntityType, RequestMethod, APIResponse } from '../../types';
import { TABLE_NAMES } from '../../types';

SyntaxHighlighter.registerLanguage('json', json);

interface ManualRequest {
  entityType: EntityType;
  method: RequestMethod;
  body: string;
  sysId?: string;
}

const defaultBodies: Record<EntityType, string> = {
  vendor: JSON.stringify(
    {
      name: '',
      status: '',
      website: '',
      notes: '',
      vendor_manager: 'Ahmed Donia',
      vendor_type: '',
      street: '',
      city: '',
      state: '',
      country: '',
      vendor: 'true',
    },
    null,
    2
  ),
  supplier: JSON.stringify(
    {
      name: '',
      legal_name: '',
      u_vendor: '',
      web_site: '',
      street: '',
      city: '',
      state: '',
      country: '',
    },
    null,
    2
  ),
  contract: JSON.stringify(
    {
      contract_model: '',
      vendor: '',
      short_description: '',
      contract_administrator: '',
      approver: '',
      starts: '2024-01-01 00:00:00',
      ends: '2025-01-01 23:59:59',
      description: '',
      renewable: 'true',
      u_payment_method: 'Invoice',
      invoice_payment_terms: 'Net 30',
      payment_schedule: 'Annual',
      payment_amount: '',
      supplier: '',
    },
    null,
    2
  ),
  expense_line: JSON.stringify(
    {
      amount: '',
      short_description: '',
      ci: '',
      contract: '',
    },
    null,
    2
  ),
  service_offering: JSON.stringify(
    {
      name: '',
      vendor: '',
      description: '',
    },
    null,
    2
  ),
  asset: JSON.stringify(
    {
      name: '',
      model: '',
      quantity: 1,
      cost: 0,
      install_status: '1',
    },
    null,
    2
  ),
  contract_asset: JSON.stringify(
    {
      contract: '',
      asset: '',
    },
    null,
    2
  ),
  cmdb_model: JSON.stringify(
    {
      name: '',
      manufacturer: '',
      short_description: '',
      cmdb_model_category: '',
    },
    null,
    2
  ),
  purchase_order: JSON.stringify(
    {
      display_name: '',
      status: '',
      supplier: '',
      total_amount: '',
      purchase_order_type: '',
      created: '',
    },
    null,
    2
  ),
  purchase_order_line: JSON.stringify(
    {
      purchase_order: '',
      product_name: '',
      short_description: '',
      purchased_quantity: '1',
      unit_price: 'USD;0.00',
      total_line_amount: 'USD;0.00',
    },
    null,
    2
  ),
  currency_instance: JSON.stringify(
    {
      amount: '',
      currency: 'USD',
      field: 'unit_price',
    },
    null,
    2
  ),
  supplier_product: JSON.stringify(
    {
      product_type: '',
      product_category: '',
      supplier: '',
      name: '',
      description: '',
    },
    null,
    2
  ),
};

export function RequestBuilder() {
  const { settings } = useSettingsStore();
  const [request, setRequest] = useState<ManualRequest>({
    entityType: 'vendor',
    method: 'POST',
    body: defaultBodies.vendor,
  });
  const [response, setResponse] = useState<APIResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [showResponse, setShowResponse] = useState(false);
  const [bodyError, setBodyError] = useState<string | null>(null);

  const handleEntityTypeChange = (entityType: EntityType) => {
    setRequest({
      ...request,
      entityType,
      body: defaultBodies[entityType],
      sysId: undefined,
    });
    setBodyError(null);
  };

  const handleMethodChange = (method: RequestMethod) => {
    setRequest({ ...request, method });
  };

  const handleBodyChange = (body: string) => {
    setRequest({ ...request, body });
    try {
      JSON.parse(body);
      setBodyError(null);
    } catch {
      setBodyError('Invalid JSON');
    }
  };

  const buildUrl = () => {
    const table = TABLE_NAMES[request.entityType];
    let url = `${settings.servicenow.instanceUrl}/api/now/table/${table}`;
    if ((request.method === 'PATCH' || request.method === 'GET') && request.sysId) {
      url += `/${request.sysId}`;
    }
    return url;
  };

  const executeRequest = async () => {
    if (!settings.servicenow.apiKey) {
      setResponse({
        status: 401,
        statusText: 'Unauthorized',
        data: null,
        headers: {},
        error: 'ServiceNow API key not configured. Please update settings.',
      });
      setShowResponse(true);
      return;
    }

    if (bodyError && (request.method === 'POST' || request.method === 'PATCH')) {
      setResponse({
        status: 400,
        statusText: 'Bad Request',
        data: null,
        headers: {},
        error: 'Invalid JSON in request body',
      });
      setShowResponse(true);
      return;
    }

    setLoading(true);
    setShowResponse(false);

    try {
      const api = initServiceNowAPI(settings.servicenow.instanceUrl, settings.servicenow.apiKey);

      let body: Record<string, unknown> | undefined;
      if (request.method === 'POST' || request.method === 'PATCH') {
        body = JSON.parse(request.body);
      }

      const result = await api.executeRequest(
        request.method,
        buildUrl(),
        { 'x-sn-apikey': settings.servicenow.apiKey },
        body
      );

      setResponse(result);
    } catch (error) {
      setResponse({
        status: 500,
        statusText: 'Error',
        data: null,
        headers: {},
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    } finally {
      setLoading(false);
      setShowResponse(true);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  return (
    <div className="p-6">
      <div className="flex items-center gap-3 mb-6">
        <Send className="w-8 h-8 text-gray-700" />
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Manual Request Builder</h1>
          <p className="text-gray-500">Construct and send API requests to ServiceNow</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-6">
        {/* Request Builder */}
        <div className="space-y-4">
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <h3 className="font-medium text-gray-900 mb-4">Request Configuration</h3>

            <div className="space-y-4">
              {/* Entity Type */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Entity Type
                </label>
                <select
                  value={request.entityType}
                  onChange={(e) => handleEntityTypeChange(e.target.value as EntityType)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                >
                  <optgroup label="Contract Related">
                    <option value="vendor">Vendor (core_company)</option>
                    <option value="supplier">Supplier (sn_fin_supplier)</option>
                    <option value="contract">Contract (ast_contract)</option>
                    <option value="expense_line">Expense Line (fm_expense_line)</option>
                    <option value="service_offering">Service Offering</option>
                  </optgroup>
                  <optgroup label="Purchase Order Related">
                    <option value="purchase_order">Purchase Order</option>
                    <option value="purchase_order_line">PO Line</option>
                    <option value="currency_instance">Currency Instance</option>
                    <option value="supplier_product">Supplier Product</option>
                  </optgroup>
                  <optgroup label="Asset Related">
                    <option value="asset">Asset (alm_asset)</option>
                    <option value="contract_asset">Contract Asset (m2m)</option>
                    <option value="cmdb_model">CMDB Model</option>
                  </optgroup>
                </select>
              </div>

              {/* Method */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  HTTP Method
                </label>
                <div className="flex gap-2">
                  {(['GET', 'POST', 'PATCH'] as RequestMethod[]).map((method) => (
                    <button
                      key={method}
                      onClick={() => handleMethodChange(method)}
                      className={clsx(
                        'px-4 py-2 rounded-lg font-medium text-sm transition-colors',
                        request.method === method
                          ? method === 'GET'
                            ? 'bg-green-100 text-green-700 border border-green-300'
                            : method === 'POST'
                            ? 'bg-blue-100 text-blue-700 border border-blue-300'
                            : 'bg-yellow-100 text-yellow-700 border border-yellow-300'
                          : 'bg-gray-100 text-gray-600 border border-gray-200 hover:bg-gray-200'
                      )}
                    >
                      {method}
                    </button>
                  ))}
                </div>
              </div>

              {/* Sys ID for PATCH/GET */}
              {(request.method === 'PATCH' || request.method === 'GET') && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Record sys_id
                  </label>
                  <input
                    type="text"
                    value={request.sysId || ''}
                    onChange={(e) => setRequest({ ...request, sysId: e.target.value })}
                    placeholder="Enter the sys_id of the record"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
              )}

              {/* URL Preview */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  URL
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={buildUrl()}
                    readOnly
                    className="flex-1 px-3 py-2 border border-gray-300 rounded-lg bg-gray-50 text-gray-600 text-sm font-mono"
                  />
                  <button
                    onClick={() => copyToClipboard(buildUrl())}
                    className="p-2 text-gray-500 hover:text-gray-700"
                  >
                    <Copy className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Request Body */}
              {(request.method === 'POST' || request.method === 'PATCH') && (
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-sm font-medium text-gray-700">
                      Request Body
                    </label>
                    {bodyError && (
                      <span className="text-xs text-red-500">{bodyError}</span>
                    )}
                  </div>
                  <textarea
                    value={request.body}
                    onChange={(e) => handleBodyChange(e.target.value)}
                    rows={12}
                    className={clsx(
                      'w-full px-3 py-2 border rounded-lg font-mono text-sm focus:ring-2 focus:ring-blue-500',
                      bodyError ? 'border-red-300' : 'border-gray-300'
                    )}
                    spellCheck={false}
                  />
                </div>
              )}

              {/* Execute Button */}
              <button
                onClick={executeRequest}
                disabled={loading || !settings.servicenow.isConnected}
                className={clsx(
                  'w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg font-medium transition-colors',
                  loading || !settings.servicenow.isConnected
                    ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                    : 'bg-blue-600 text-white hover:bg-blue-700'
                )}
              >
                {loading ? (
                  <>
                    <span className="animate-spin">⏳</span>
                    Executing...
                  </>
                ) : (
                  <>
                    <Play className="w-4 h-4" />
                    Execute Request
                  </>
                )}
              </button>

              {!settings.servicenow.isConnected && (
                <p className="text-sm text-red-500 text-center">
                  Please configure and test your ServiceNow connection in Settings
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Response Panel */}
        <div className="space-y-4">
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <div
              className="flex items-center justify-between cursor-pointer"
              onClick={() => setShowResponse(!showResponse)}
            >
              <h3 className="font-medium text-gray-900">Response</h3>
              {showResponse ? (
                <ChevronDown className="w-5 h-5 text-gray-500" />
              ) : (
                <ChevronRight className="w-5 h-5 text-gray-500" />
              )}
            </div>

            {showResponse && response && (
              <div className="mt-4 space-y-3">
                {/* Status */}
                <div className="flex items-center gap-4">
                  <span
                    className={clsx(
                      'px-3 py-1 rounded-full text-sm font-medium',
                      response.status >= 200 && response.status < 300
                        ? 'bg-green-100 text-green-700'
                        : response.status >= 400
                        ? 'bg-red-100 text-red-700'
                        : 'bg-yellow-100 text-yellow-700'
                    )}
                  >
                    {response.status} {response.statusText}
                  </span>
                  {response.error && (
                    <span className="text-sm text-red-600">{response.error}</span>
                  )}
                </div>

                {/* Response Body */}
                <div className="bg-gray-900 rounded-lg overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-2 bg-gray-800">
                    <span className="text-sm text-gray-400">Response Body</span>
                    <button
                      onClick={() =>
                        copyToClipboard(JSON.stringify(response.data, null, 2))
                      }
                      className="text-gray-400 hover:text-white"
                    >
                      <Copy className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="max-h-96 overflow-auto">
                    <SyntaxHighlighter
                      language="json"
                      style={atomOneDark}
                      customStyle={{
                        margin: 0,
                        padding: '1rem',
                        fontSize: '0.75rem',
                      }}
                    >
                      {String(JSON.stringify(response.data, null, 2) || 'No response body')}
                    </SyntaxHighlighter>
                  </div>
                </div>

                {/* Extract sys_id if present */}
                {(() => {
                  const data = response.data as { result?: { sys_id?: string } } | null;
                  const sysId = data?.result?.sys_id;
                  if (!sysId) return null;
                  return (
                    <div className="p-3 bg-green-50 border border-green-200 rounded-lg">
                      <p className="text-sm text-green-700">
                        <strong>Created sys_id:</strong> {sysId}
                      </p>
                    </div>
                  );
                })()}
              </div>
            )}

            {showResponse && !response && (
              <p className="mt-4 text-gray-500 text-sm">No response yet. Execute a request to see results.</p>
            )}
          </div>

          {/* Quick Reference */}
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <h3 className="font-medium text-gray-900 mb-3">Quick Reference</h3>
            <div className="text-sm text-gray-600 space-y-2">
              <p>
                <strong>POST:</strong> Create a new record
              </p>
              <p>
                <strong>GET:</strong> Retrieve record(s)
              </p>
              <p>
                <strong>PATCH:</strong> Update an existing record (requires sys_id)
              </p>
              <hr className="my-2" />
              <p className="text-xs text-gray-500">
                Table: <code className="bg-gray-100 px-1 rounded">{TABLE_NAMES[request.entityType]}</code>
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
