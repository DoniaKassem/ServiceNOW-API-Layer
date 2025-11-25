// ServiceNow reference field type
export interface ServiceNowReference {
  link: string;
  value: string;
}

// ServiceNow Entity Types
export interface Vendor {
  sys_id?: string;
  name: string;
  status?: string;
  website?: string;
  notes?: string;
  vendor_manager?: string;
  vendor_type?: string;
  street?: string;
  city?: string;
  state?: string;
  country?: string;
  vendor?: string;
  supplier?: ServiceNowReference | string; // Can be a reference object or sys_id string
}

export interface Supplier {
  sys_id?: string;
  name: string;
  legal_name?: string;
  u_vendor?: string;
  web_site?: string;
  street?: string;
  city?: string;
  state?: string;
  country?: string;
  zip?: string;
  number?: string;
  active?: string;
  short_description?: string;
}

export interface Contract {
  sys_id?: string;
  number?: string;
  contract_model?: string;
  vendor?: string;
  supplier?: string;
  short_description?: string;
  description?: string;
  contract_administrator?: string;
  approver?: string;
  vendor_contract?: string;
  starts?: string;
  ends?: string;
  renewable?: string;
  u_payment_method?: string;
  invoice_payment_terms?: string;
  payment_schedule?: string;
  payment_amount?: string;
  total_cost?: string;
  monthly_cost?: string;
  yearly_cost?: string;
  state?: string;
  active?: string;
}

export interface ExpenseLine {
  sys_id?: string;
  amount?: string;
  short_description?: string;
  ci?: string;
  contract?: string;
}

export interface ServiceOffering {
  sys_id?: string;
  name: string;
  vendor?: string;
  description?: string;
}

export interface Asset {
  sys_id?: string;
  name: string;
  model?: string;
  quantity?: number;
  cost?: number;
  install_status?: string;
}

export interface ContractAsset {
  sys_id?: string;
  contract: string;
  asset: string;
}

export interface CMDBModel {
  sys_id?: string;
  name: string;
  manufacturer?: string;
  short_description?: string;
  cmdb_model_category?: string;
}

export interface PurchaseOrder {
  sys_id?: string;
  display_name?: string;
  status?: string;
  supplier?: string;
  total_amount?: string;
  purchase_order_type?: string;
  created?: string;
  number?: string;
}

export interface PurchaseOrderLine {
  sys_id?: string;
  purchase_order: string;
  product_name?: string;
  short_description?: string;
  purchased_quantity?: string;
  unit_price?: string;
  total_line_amount?: string;
}

export interface CurrencyInstance {
  sys_id?: string;
  amount: string;
  currency: string;
  field: string;
}

export interface SupplierProduct {
  sys_id?: string;
  product_type?: string;
  product_category?: string;
  supplier?: string;
  name: string;
  description?: string;
}

// Application Types
export type DocumentType =
  | 'contract'
  | 'amendment'
  | 'purchase_order'
  | 'invoice'
  | 'unknown';

export interface DocumentClassification {
  type: DocumentType;
  confidence: number;
  reasoning: string;
}

export interface ExtractedEntity {
  field: string;
  value: string;
  confidence: number;
  source?: string;
}

export interface ExtractedData {
  documentType: DocumentType;
  classification: DocumentClassification;
  vendor?: Partial<Vendor>;
  supplier?: Partial<Supplier>;
  contract?: Partial<Contract>;
  purchaseOrder?: Partial<PurchaseOrder>;
  expenseLines?: Partial<ExpenseLine>[];
  purchaseOrderLines?: Partial<PurchaseOrderLine>[];
  rawEntities: ExtractedEntity[];
  linkedSupplierSysId?: string; // Supplier sys_id from linked vendor record
}

export type RequestMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE';

export type RequestStatus =
  | 'pending'
  | 'approved'
  | 'executing'
  | 'success'
  | 'failed';

export type EntityType =
  | 'vendor'
  | 'supplier'
  | 'contract'
  | 'expense_line'
  | 'service_offering'
  | 'asset'
  | 'contract_asset'
  | 'cmdb_model'
  | 'purchase_order'
  | 'purchase_order_line'
  | 'currency_instance'
  | 'supplier_product';

export interface APIRequest {
  id: string;
  entityType: EntityType;
  method: RequestMethod;
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
  status: RequestStatus;
  dependsOn?: string[];
  response?: APIResponse;
  createdAt: Date;
  executedAt?: Date;
  modifiedBody?: Record<string, unknown>;
}

export interface APIResponse {
  status: number;
  statusText: string;
  data: unknown;
  headers: Record<string, string>;
  error?: string;
}

export interface MatchResult {
  entity: unknown;
  confidence: number;
  matchType: 'exact' | 'partial' | 'none';
  reason: string;
}

export type SessionStatus = 'in_progress' | 'completed' | 'failed';

export interface IngestionSession {
  id: string;
  fileName: string;
  documentType?: DocumentType;
  status: SessionStatus;
  createdAt: Date;
  updatedAt: Date;
  extractedData?: ExtractedData;
  requests: APIRequest[];
  auditLog: AuditEntry[];
}

export interface AuditEntry {
  id: string;
  timestamp: Date;
  action: string;
  details: string;
  user?: string;
  beforeValue?: unknown;
  afterValue?: unknown;
}

export interface AppSettings {
  servicenow: {
    instanceUrl: string;
    apiKey: string;
    isConnected: boolean;
  };
  openai: {
    apiKey: string;
    model: string;
    temperature: number;
    maxTokens: number;
  };
  defaults: {
    vendorManager: string;
    contractAdministrator: string;
    approver: string;
    currency: string;
    autoSaveDrafts: boolean;
  };
}

// Table name mapping
export const TABLE_NAMES: Record<EntityType, string> = {
  vendor: 'core_company',
  supplier: 'sn_fin_supplier',
  contract: 'ast_contract',
  expense_line: 'fm_expense_line',
  service_offering: 'service_offering',
  asset: 'alm_asset',
  contract_asset: 'clm_m2m_contract_asset',
  cmdb_model: 'cmdb_model',
  purchase_order: 'sn_shop_purchase_order',
  purchase_order_line: 'sn_shop_purchase_order_line',
  currency_instance: 'fx_currency2_instance',
  supplier_product: 'sn_shop_supplier_product',
};

// Entity dependency order for execution
export const ENTITY_EXECUTION_ORDER: EntityType[] = [
  'vendor',
  'supplier',
  'cmdb_model',
  'service_offering',
  'asset',
  'contract',
  'purchase_order',
  'expense_line',
  'purchase_order_line',
  'contract_asset',
  'currency_instance',
  'supplier_product',
];

// ============ Request Log Types ============
export interface RequestLogEntry {
  id: string;
  timestamp: Date;
  method: RequestMethod;
  url: string;
  table?: string;
  recordSysId?: string;
  headers: Record<string, string>;
  body?: Record<string, unknown>;
  responseStatus?: number;
  responseBody?: unknown;
  duration?: number;
  error?: string;
  sessionId?: string;
}

// ============ Table View Types ============
export type TableViewType = 'contracts' | 'purchase_orders' | 'suppliers' | 'vendors';

export const TABLE_VIEW_CONFIG: Record<TableViewType, {
  table: string;
  entityType: EntityType;
  label: string;
  defaultQuery?: string;
}> = {
  contracts: {
    table: 'ast_contract',
    entityType: 'contract',
    label: 'Contracts',
  },
  purchase_orders: {
    table: 'sn_shop_purchase_order',
    entityType: 'purchase_order',
    label: 'Purchase Orders',
  },
  suppliers: {
    table: 'sn_fin_supplier',
    entityType: 'supplier',
    label: 'Suppliers',
  },
  vendors: {
    table: 'core_company',
    entityType: 'vendor',
    label: 'Vendors',
    defaultQuery: 'vendor=true',
  },
};

export const DEFAULT_COLUMNS: Record<TableViewType, string[]> = {
  contracts: [
    'number',
    'short_description',
    'vendor',
    'supplier',
    'starts',
    'ends',
    'state',
    'payment_amount',
    'payment_schedule',
    'total_cost',
  ],
  purchase_orders: [
    'display_name',
    'status',
    'supplier',
    'total_amount',
    'purchase_order_type',
    'created',
  ],
  suppliers: [
    'name',
    'legal_name',
    'u_vendor',
    'web_site',
    'city',
    'state',
    'country',
  ],
  vendors: [
    'name',
    'status',
    'vendor_type',
    'vendor_manager',
    'website',
    'city',
    'state',
    'country',
  ],
};

export interface ColumnConfig {
  field: string;
  label: string;
  visible: boolean;
  order: number;
  type?: 'text' | 'reference' | 'date' | 'number' | 'boolean' | 'currency';
}

export interface TableViewState {
  viewType: TableViewType;
  columns: ColumnConfig[];
  sortField?: string;
  sortDirection?: 'asc' | 'desc';
  page: number;
  pageSize: number;
  searchQuery?: string;
  filters: FilterCondition[];
}

export interface FilterCondition {
  id: string;
  field: string;
  operator: FilterOperator;
  value: string;
  connector?: 'AND' | 'OR';
}

export type FilterOperator =
  | 'equals'
  | 'not_equals'
  | 'contains'
  | 'starts_with'
  | 'greater_than'
  | 'less_than'
  | 'between'
  | 'is_empty'
  | 'is_not_empty';

// ============ Workflow Automation Types ============
export type ApprovalLevel = 'manual' | 'validated' | 'automated';

export interface WorkflowConfig {
  id: string;
  name: string;
  description: string;
  method: RequestMethod;
  table: string;
  approvalLevel: ApprovalLevel;
  lastExecuted?: Date;
  successCount: number;
  failureCount: number;
}

// ============ Duplicate Detection Types ============
export interface DuplicateMatch {
  sysId: string;
  displayValue: string;
  matchType: 'exact' | 'partial';
  matchedFields: string[];
  record: Record<string, unknown>;
}

export interface DuplicateCheckResult {
  hasDuplicates: boolean;
  matches: DuplicateMatch[];
  checkedFields: string[];
}

// ============ Expense Line Classification Types ============
export type ClassificationType = 'none' | 'configuration_item' | 'offering' | 'asset';

export interface ExpenseLineClassification {
  expenseLineId: string;
  classificationType: ClassificationType;
  linkedSysId?: string;
  linkedDisplayValue?: string;
}

// ============ Bulk Operation Types ============
export interface BulkOperationResult {
  totalRecords: number;
  successCount: number;
  failureCount: number;
  results: {
    sysId: string;
    success: boolean;
    error?: string;
  }[];
}
