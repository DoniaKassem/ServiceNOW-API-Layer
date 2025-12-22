import axios, { type AxiosInstance, type AxiosError } from 'axios';
import type {
  Vendor,
  Supplier,
  Contract,
  ExpenseLine,
  ServiceOffering,
  Asset,
  ContractAsset,
  CMDBModel,
  PurchaseOrder,
  PurchaseOrderLine,
  CurrencyInstance,
  SupplierProduct,
  Attachment,
  APIResponse,
} from '../types';

// ServiceNow API Error Response
interface ServiceNowError {
  error: {
    message: string;
    detail?: string;
  };
  status: string;
}

// ServiceNow API Response wrapper
interface ServiceNowResponse<T> {
  result: T;
}

export class ServiceNowAPI {
  private client: AxiosInstance;
  private instanceUrl: string;

  constructor(instanceUrl: string, apiKey: string) {
    this.instanceUrl = instanceUrl;

    // In development mode, use the Vite proxy to avoid CORS issues
    // The proxy is configured in vite.config.ts to rewrite /api/servicenow -> /api/now
    const isDev = import.meta.env.DEV;
    const baseURL = isDev ? '/api/servicenow' : `${instanceUrl}/api/now`;

    this.client = axios.create({
      baseURL,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'x-sn-apikey': apiKey,
      },
    });
  }

  // Helper to format error responses
  private formatError(error: AxiosError<ServiceNowError>): APIResponse {
    const status = error.response?.status || 500;
    const statusText = error.response?.statusText || 'Unknown Error';
    const data = error.response?.data;

    let errorMessage = 'An unknown error occurred';

    if (data?.error?.message) {
      errorMessage = data.error.message;
      if (data.error.detail) {
        errorMessage += `: ${data.error.detail}`;
      }
    } else if (error.message) {
      errorMessage = error.message;
    }

    // Map common errors to user-friendly messages
    const friendlyMessages: Record<number, string> = {
      401: 'API key is invalid or expired. Please check your settings.',
      403: 'You lack permissions to access this resource. Required roles may be missing.',
      404: 'The requested record or table was not found.',
      409: 'A conflict occurred - possible duplicate key or business rule violation.',
      429: 'Rate limited. Please wait before making more requests.',
    };

    return {
      status,
      statusText,
      data: data,
      headers: {},
      error: friendlyMessages[status] || errorMessage,
    };
  }

  // Test connection
  async testConnection(): Promise<boolean> {
    try {
      await this.client.get('/table/sys_user', {
        params: { sysparm_limit: 1 },
      });
      return true;
    } catch {
      return false;
    }
  }

  // Generic GET request
  async get<T>(
    table: string,
    params?: Record<string, string | number | boolean>
  ): Promise<ServiceNowResponse<T[]>> {
    const response = await this.client.get<ServiceNowResponse<T[]>>(
      `/table/${table}`,
      { params }
    );
    return response.data;
  }

  // Generic GET by sys_id
  async getById<T>(table: string, sysId: string): Promise<ServiceNowResponse<T>> {
    const response = await this.client.get<ServiceNowResponse<T>>(
      `/table/${table}/${sysId}`
    );
    return response.data;
  }

  // Generic POST request
  async create<T>(table: string, data: Partial<T>): Promise<ServiceNowResponse<T>> {
    const response = await this.client.post<ServiceNowResponse<T>>(
      `/table/${table}`,
      data
    );
    return response.data;
  }

  // Generic PATCH request
  async update<T>(
    table: string,
    sysId: string,
    data: Partial<T>
  ): Promise<ServiceNowResponse<T>> {
    const response = await this.client.patch<ServiceNowResponse<T>>(
      `/table/${table}/${sysId}`,
      data
    );
    return response.data;
  }

  // Generic DELETE request
  async delete(table: string, sysId: string): Promise<void> {
    await this.client.delete(`/table/${table}/${sysId}`);
  }

  // Execute raw request
  async executeRequest(
    method: string,
    url: string,
    headers: Record<string, string>,
    body?: Record<string, unknown>
  ): Promise<APIResponse> {
    try {
      // In dev mode, extract just the path from full URLs to use the proxy
      // Full URLs like "https://instance.service-now.com/api/now/table/..."
      // need to be converted to relative paths "/table/..."
      let requestUrl = url;
      const isDev = import.meta.env.DEV;

      if (isDev && url.includes('/api/now/')) {
        // Extract the path after /api/now
        const apiNowIndex = url.indexOf('/api/now/');
        if (apiNowIndex !== -1) {
          requestUrl = url.substring(apiNowIndex + '/api/now'.length);
        }
      }

      const response = await this.client.request({
        method,
        url: requestUrl,
        headers,
        data: body,
      });

      return {
        status: response.status,
        statusText: response.statusText,
        data: response.data,
        headers: response.headers as Record<string, string>,
      };
    } catch (error) {
      return this.formatError(error as AxiosError<ServiceNowError>);
    }
  }

  // ============ VENDOR (core_company) ============
  async getVendors(params?: {
    query?: string;
    limit?: number;
    offset?: number;
  }): Promise<ServiceNowResponse<Vendor[]>> {
    return this.get<Vendor>('core_company', {
      sysparm_query: params?.query || 'vendor=true',
      sysparm_limit: params?.limit || 100,
      sysparm_offset: params?.offset || 0,
    });
  }

  async getVendorById(sysId: string): Promise<ServiceNowResponse<Vendor>> {
    return this.getById<Vendor>('core_company', sysId);
  }

  async createVendor(vendor: Partial<Vendor>): Promise<ServiceNowResponse<Vendor>> {
    return this.create<Vendor>('core_company', { ...vendor, vendor: 'true' });
  }

  async updateVendor(
    sysId: string,
    vendor: Partial<Vendor>
  ): Promise<ServiceNowResponse<Vendor>> {
    return this.update<Vendor>('core_company', sysId, vendor);
  }

  async searchVendors(name: string): Promise<ServiceNowResponse<Vendor[]>> {
    return this.get<Vendor>('core_company', {
      sysparm_query: `vendor=true^nameLIKE${name}^ORwebsiteLIKE${name}`,
      sysparm_limit: 20,
      sysparm_fields: 'sys_id,name,website,vendor_type,street,city,state,country,supplier',
      sysparm_display_value: 'all', // Returns both display value and sys_id for reference fields
    });
  }

  // ============ SUPPLIER (sn_fin_supplier) ============
  async getSuppliers(params?: {
    query?: string;
    limit?: number;
    offset?: number;
  }): Promise<ServiceNowResponse<Supplier[]>> {
    return this.get<Supplier>('sn_fin_supplier', {
      sysparm_query: params?.query || '',
      sysparm_limit: params?.limit || 100,
      sysparm_offset: params?.offset || 0,
    });
  }

  async getSupplierById(sysId: string): Promise<ServiceNowResponse<Supplier>> {
    return this.getById<Supplier>('sn_fin_supplier', sysId);
  }

  async createSupplier(
    supplier: Partial<Supplier>
  ): Promise<ServiceNowResponse<Supplier>> {
    return this.create<Supplier>('sn_fin_supplier', supplier);
  }

  async updateSupplier(
    sysId: string,
    supplier: Partial<Supplier>
  ): Promise<ServiceNowResponse<Supplier>> {
    return this.update<Supplier>('sn_fin_supplier', sysId, supplier);
  }

  async searchSuppliers(name: string): Promise<ServiceNowResponse<Supplier[]>> {
    return this.get<Supplier>('sn_fin_supplier', {
      sysparm_query: `nameLIKE${name}^ORlegal_nameLIKE${name}`,
      sysparm_limit: 20,
    });
  }

  // ============ CONTRACT (ast_contract) ============
  async getContracts(params?: {
    query?: string;
    limit?: number;
    offset?: number;
  }): Promise<ServiceNowResponse<Contract[]>> {
    return this.get<Contract>('ast_contract', {
      sysparm_query: params?.query || '',
      sysparm_limit: params?.limit || 100,
      sysparm_offset: params?.offset || 0,
    });
  }

  async getContractById(sysId: string): Promise<ServiceNowResponse<Contract>> {
    return this.getById<Contract>('ast_contract', sysId);
  }

  async createContract(
    contract: Partial<Contract>
  ): Promise<ServiceNowResponse<Contract>> {
    return this.create<Contract>('ast_contract', contract);
  }

  async updateContract(
    sysId: string,
    contract: Partial<Contract>
  ): Promise<ServiceNowResponse<Contract>> {
    return this.update<Contract>('ast_contract', sysId, contract);
  }

  async searchContracts(params: {
    vendorId?: string;
    number?: string;
    startDate?: string;
    endDate?: string;
  }): Promise<ServiceNowResponse<Contract[]>> {
    const queryParts: string[] = [];
    if (params.vendorId) queryParts.push(`vendor=${params.vendorId}`);
    if (params.number) queryParts.push(`numberLIKE${params.number}`);
    if (params.startDate) queryParts.push(`starts>=${params.startDate}`);
    if (params.endDate) queryParts.push(`ends<=${params.endDate}`);

    return this.get<Contract>('ast_contract', {
      sysparm_query: queryParts.join('^'),
      sysparm_limit: 20,
    });
  }

  // ============ EXPENSE LINE (fm_expense_line) ============
  async getExpenseLines(
    contractId?: string
  ): Promise<ServiceNowResponse<ExpenseLine[]>> {
    return this.get<ExpenseLine>('fm_expense_line', {
      sysparm_query: contractId ? `contract=${contractId}` : '',
      sysparm_limit: 100,
    });
  }

  async createExpenseLine(
    expenseLine: Partial<ExpenseLine>
  ): Promise<ServiceNowResponse<ExpenseLine>> {
    return this.create<ExpenseLine>('fm_expense_line', expenseLine);
  }

  async updateExpenseLine(
    sysId: string,
    expenseLine: Partial<ExpenseLine>
  ): Promise<ServiceNowResponse<ExpenseLine>> {
    return this.update<ExpenseLine>('fm_expense_line', sysId, expenseLine);
  }

  // ============ SERVICE OFFERING (service_offering) ============
  async getServiceOfferings(
    vendorId?: string
  ): Promise<ServiceNowResponse<ServiceOffering[]>> {
    return this.get<ServiceOffering>('service_offering', {
      sysparm_query: vendorId ? `vendor=${vendorId}` : '',
      sysparm_limit: 100,
    });
  }

  async createServiceOffering(
    offering: Partial<ServiceOffering>
  ): Promise<ServiceNowResponse<ServiceOffering>> {
    return this.create<ServiceOffering>('service_offering', offering);
  }

  // ============ ASSET (alm_asset) ============
  async getAssets(params?: {
    query?: string;
    limit?: number;
  }): Promise<ServiceNowResponse<Asset[]>> {
    return this.get<Asset>('alm_asset', {
      sysparm_query: params?.query || '',
      sysparm_limit: params?.limit || 100,
    });
  }

  async createAsset(asset: Partial<Asset>): Promise<ServiceNowResponse<Asset>> {
    return this.create<Asset>('alm_asset', asset);
  }

  // ============ CONTRACT ASSET (clm_m2m_contract_asset) ============
  async createContractAsset(
    contractAsset: Partial<ContractAsset>
  ): Promise<ServiceNowResponse<ContractAsset>> {
    return this.create<ContractAsset>('clm_m2m_contract_asset', contractAsset);
  }

  // ============ CMDB MODEL (cmdb_model) ============
  async getModels(params?: {
    query?: string;
    limit?: number;
  }): Promise<ServiceNowResponse<CMDBModel[]>> {
    return this.get<CMDBModel>('cmdb_model', {
      sysparm_query: params?.query || '',
      sysparm_limit: params?.limit || 100,
    });
  }

  async createModel(model: Partial<CMDBModel>): Promise<ServiceNowResponse<CMDBModel>> {
    return this.create<CMDBModel>('cmdb_model', model);
  }

  async updateModel(
    sysId: string,
    model: Partial<CMDBModel>
  ): Promise<ServiceNowResponse<CMDBModel>> {
    return this.update<CMDBModel>('cmdb_model', sysId, model);
  }

  // ============ PURCHASE ORDER (sn_shop_purchase_order) ============
  async getPurchaseOrders(params?: {
    query?: string;
    limit?: number;
    offset?: number;
  }): Promise<ServiceNowResponse<PurchaseOrder[]>> {
    return this.get<PurchaseOrder>('sn_shop_purchase_order', {
      sysparm_query: params?.query || '',
      sysparm_limit: params?.limit || 100,
      sysparm_offset: params?.offset || 0,
    });
  }

  async getPurchaseOrderById(
    sysId: string
  ): Promise<ServiceNowResponse<PurchaseOrder>> {
    return this.getById<PurchaseOrder>('sn_shop_purchase_order', sysId);
  }

  async createPurchaseOrder(
    po: Partial<PurchaseOrder>
  ): Promise<ServiceNowResponse<PurchaseOrder>> {
    return this.create<PurchaseOrder>('sn_shop_purchase_order', po);
  }

  async updatePurchaseOrder(
    sysId: string,
    po: Partial<PurchaseOrder>
  ): Promise<ServiceNowResponse<PurchaseOrder>> {
    return this.update<PurchaseOrder>('sn_shop_purchase_order', sysId, po);
  }

  // ============ PURCHASE ORDER LINE (sn_shop_purchase_order_line) ============
  async getPurchaseOrderLines(
    poId?: string
  ): Promise<ServiceNowResponse<PurchaseOrderLine[]>> {
    return this.get<PurchaseOrderLine>('sn_shop_purchase_order_line', {
      sysparm_query: poId ? `purchase_order=${poId}` : '',
      sysparm_limit: 100,
    });
  }

  async createPurchaseOrderLine(
    line: Partial<PurchaseOrderLine>
  ): Promise<ServiceNowResponse<PurchaseOrderLine>> {
    return this.create<PurchaseOrderLine>('sn_shop_purchase_order_line', line);
  }

  // ============ CURRENCY INSTANCE (fx_currency2_instance) ============
  async createCurrencyInstance(
    instance: Partial<CurrencyInstance>
  ): Promise<ServiceNowResponse<CurrencyInstance>> {
    return this.create<CurrencyInstance>('fx_currency2_instance', instance);
  }

  // ============ SUPPLIER PRODUCT (sn_shop_supplier_product) ============
  async getSupplierProducts(
    supplierId?: string
  ): Promise<ServiceNowResponse<SupplierProduct[]>> {
    return this.get<SupplierProduct>('sn_shop_supplier_product', {
      sysparm_query: supplierId ? `supplier=${supplierId}` : '',
      sysparm_limit: 100,
    });
  }

  async createSupplierProduct(
    product: Partial<SupplierProduct>
  ): Promise<ServiceNowResponse<SupplierProduct>> {
    return this.create<SupplierProduct>('sn_shop_supplier_product', product);
  }

  async updateSupplierProduct(
    sysId: string,
    product: Partial<SupplierProduct>
  ): Promise<ServiceNowResponse<SupplierProduct>> {
    return this.update<SupplierProduct>('sn_shop_supplier_product', sysId, product);
  }

  // ============ ATTACHMENTS ============
  async uploadAttachment(
    tableName: string,
    tableSysId: string,
    file: File
  ): Promise<APIResponse> {
    const formData = new FormData();
    formData.append('table_name', tableName);
    formData.append('table_sys_id', tableSysId);
    formData.append('file', file);

    try {
      const response = await this.client.post('/attachment/upload', formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });

      return {
        status: response.status,
        statusText: response.statusText,
        data: response.data,
        headers: response.headers as Record<string, string>,
      };
    } catch (error) {
      return this.formatError(error as AxiosError<ServiceNowError>);
    }
  }

  async getAttachments(
    tableName: string,
    tableSysId: string
  ): Promise<ServiceNowResponse<Attachment[]>> {
    return this.get<Attachment>('attachment', {
      sysparm_query: `table_name=${tableName}^table_sys_id=${tableSysId}`,
      sysparm_fields: 'sys_id,file_name,content_type,size_bytes,download_link,sys_created_on',
    });
  }

  async getAllContractAttachments(): Promise<ServiceNowResponse<Attachment[]>> {
    return this.get<Attachment>('attachment', {
      sysparm_query: 'table_name=ast_contract',
      sysparm_fields: 'sys_id,file_name,content_type,size_bytes,download_link,sys_created_on,table_sys_id',
      sysparm_limit: 500,
    });
  }

  async deleteAttachment(sysId: string): Promise<void> {
    await this.delete('attachment', sysId);
  }

  async getAttachmentContent(sysId: string): Promise<Blob> {
    const response = await this.client.get(`/attachment/${sysId}/file`, {
      responseType: 'blob',
    });
    return response.data;
  }

  // Get the instance URL (used for display purposes)
  getInstanceUrl(): string {
    return this.instanceUrl;
  }
}

// Singleton instance (rebuilt automatically if credentials change)
let apiInstance: ServiceNowAPI | null = null;
let apiConfig: { instanceUrl: string; apiKey: string } | null = null;

function hasSameConfig(instanceUrl: string, apiKey: string): boolean {
  return (
    apiConfig != null &&
    apiConfig.instanceUrl === instanceUrl &&
    apiConfig.apiKey === apiKey
  );
}

export function getServiceNowAPI(instanceUrl?: string, apiKey?: string): ServiceNowAPI {
  // If caller provides credentials, ensure the singleton matches them.
  // This prevents stale clients when users update settings at runtime.
  if (instanceUrl && apiKey) {
    if (!apiInstance || !hasSameConfig(instanceUrl, apiKey)) {
      apiInstance = new ServiceNowAPI(instanceUrl, apiKey);
      apiConfig = { instanceUrl, apiKey };
    }
  }

  if (!apiInstance) {
    throw new Error('ServiceNow API not initialized. Please configure your settings.');
  }

  return apiInstance;
}

export function initServiceNowAPI(instanceUrl: string, apiKey: string): ServiceNowAPI {
  apiInstance = new ServiceNowAPI(instanceUrl, apiKey);
  apiConfig = { instanceUrl, apiKey };
  return apiInstance;
}

export function resetServiceNowAPI(): void {
  apiInstance = null;
  apiConfig = null;
}
