import type { TableViewType } from '../types';

export interface FieldMetadata {
  field: string;
  label: string;
  description?: string;
  type: 'string' | 'integer' | 'decimal' | 'boolean' | 'reference' | 'date' | 'datetime' | 'choice' | 'currency' | 'email' | 'url' | 'phone';
  maxLength?: number;
  required?: boolean;
  reference?: string; // Reference table name
  choices?: { value: string; label: string }[];
  pattern?: RegExp;
  patternMessage?: string;
  min?: number;
  max?: number;
}

// Common ServiceNow fields
const COMMON_FIELDS: Record<string, Omit<FieldMetadata, 'field' | 'label'>> = {
  sys_id: {
    type: 'string',
    description: 'Unique identifier for this record (auto-generated)',
    maxLength: 32,
  },
  sys_created_on: {
    type: 'datetime',
    description: 'Date and time when this record was created',
  },
  sys_updated_on: {
    type: 'datetime',
    description: 'Date and time when this record was last updated',
  },
  sys_created_by: {
    type: 'string',
    description: 'User who created this record',
  },
  sys_updated_by: {
    type: 'string',
    description: 'User who last updated this record',
  },
  sys_mod_count: {
    type: 'integer',
    description: 'Number of times this record has been modified',
  },
  active: {
    type: 'boolean',
    description: 'Indicates if this record is active or inactive',
  },
  name: {
    type: 'string',
    description: 'Display name for this record',
    maxLength: 100,
    required: true,
  },
  short_description: {
    type: 'string',
    description: 'Brief description of this record',
    maxLength: 200,
  },
  description: {
    type: 'string',
    description: 'Detailed description of this record',
    maxLength: 4000,
  },
};

// Field metadata by table view type
export const FIELD_METADATA: Record<TableViewType, FieldMetadata[]> = {
  vendors: [
    { field: 'name', label: 'Company Name', type: 'string', required: true, maxLength: 100, description: 'Legal name of the vendor company' },
    { field: 'vendor_type', label: 'Vendor Type', type: 'choice', description: 'Classification of the vendor', choices: [
      { value: 'hardware', label: 'Hardware' },
      { value: 'software', label: 'Software' },
      { value: 'services', label: 'Services' },
      { value: 'consulting', label: 'Consulting' },
    ]},
    { field: 'street', label: 'Street Address', type: 'string', maxLength: 255, description: 'Street address of vendor headquarters' },
    { field: 'city', label: 'City', type: 'string', maxLength: 50, description: 'City where vendor is located' },
    { field: 'state', label: 'State/Province', type: 'string', maxLength: 50, description: 'State or province' },
    { field: 'zip', label: 'ZIP/Postal Code', type: 'string', maxLength: 20, pattern: /^[A-Za-z0-9\s-]+$/, patternMessage: 'Enter a valid postal code' },
    { field: 'country', label: 'Country', type: 'string', maxLength: 50, description: 'Country where vendor is located' },
    { field: 'phone', label: 'Phone', type: 'phone', description: 'Primary contact phone number' },
    { field: 'fax', label: 'Fax', type: 'phone', description: 'Fax number' },
    { field: 'website', label: 'Website', type: 'url', description: 'Company website URL', pattern: /^https?:\/\/.+/, patternMessage: 'Enter a valid URL starting with http:// or https://' },
    { field: 'email', label: 'Email', type: 'email', description: 'Primary contact email', pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/, patternMessage: 'Enter a valid email address' },
    { field: 'primary_contact', label: 'Primary Contact', type: 'reference', reference: 'sys_user', description: 'Main point of contact at the vendor' },
    { field: 'notes', label: 'Notes', type: 'string', maxLength: 4000, description: 'Additional notes about this vendor' },
  ],

  suppliers: [
    { field: 'name', label: 'Supplier Name', type: 'string', required: true, maxLength: 100, description: 'Legal name of the supplier' },
    { field: 'supplier_id', label: 'Supplier ID', type: 'string', maxLength: 40, description: 'Unique identifier for the supplier' },
    { field: 'status', label: 'Status', type: 'choice', description: 'Current status of the supplier relationship', choices: [
      { value: 'active', label: 'Active' },
      { value: 'inactive', label: 'Inactive' },
      { value: 'pending', label: 'Pending Approval' },
      { value: 'suspended', label: 'Suspended' },
    ]},
    { field: 'currency', label: 'Currency', type: 'reference', reference: 'fx_currency', description: 'Default currency for transactions' },
    { field: 'payment_terms', label: 'Payment Terms', type: 'string', maxLength: 100, description: 'Standard payment terms (e.g., Net 30)' },
    { field: 'tax_id', label: 'Tax ID', type: 'string', maxLength: 40, description: 'Tax identification number' },
    { field: 'bank_account', label: 'Bank Account', type: 'string', maxLength: 50, description: 'Bank account number for payments' },
    { field: 'contact_name', label: 'Contact Name', type: 'string', maxLength: 100, description: 'Primary contact person name' },
    { field: 'contact_email', label: 'Contact Email', type: 'email', description: 'Primary contact email address' },
    { field: 'contact_phone', label: 'Contact Phone', type: 'phone', description: 'Primary contact phone number' },
  ],

  contracts: [
    { field: 'number', label: 'Contract Number', type: 'string', required: true, maxLength: 40, description: 'Unique contract identifier' },
    { field: 'short_description', label: 'Description', type: 'string', required: true, maxLength: 200, description: 'Brief description of the contract' },
    { field: 'vendor', label: 'Vendor', type: 'reference', reference: 'core_company', required: true, description: 'Vendor party to this contract' },
    { field: 'contract_type', label: 'Contract Type', type: 'choice', description: 'Type of contract', choices: [
      { value: 'service', label: 'Service Agreement' },
      { value: 'license', label: 'License Agreement' },
      { value: 'maintenance', label: 'Maintenance' },
      { value: 'lease', label: 'Lease' },
      { value: 'nda', label: 'NDA' },
    ]},
    { field: 'state', label: 'State', type: 'choice', description: 'Current state of the contract', choices: [
      { value: 'draft', label: 'Draft' },
      { value: 'review', label: 'Under Review' },
      { value: 'active', label: 'Active' },
      { value: 'expired', label: 'Expired' },
      { value: 'cancelled', label: 'Cancelled' },
    ]},
    { field: 'starts', label: 'Start Date', type: 'date', required: true, description: 'Date when the contract becomes effective' },
    { field: 'ends', label: 'End Date', type: 'date', required: true, description: 'Date when the contract expires' },
    { field: 'contract_value', label: 'Contract Value', type: 'currency', description: 'Total value of the contract' },
    { field: 'annual_cost', label: 'Annual Cost', type: 'currency', description: 'Yearly cost under this contract' },
    { field: 'owner', label: 'Contract Owner', type: 'reference', reference: 'sys_user', description: 'Person responsible for managing this contract' },
    { field: 'department', label: 'Department', type: 'reference', reference: 'cmn_department', description: 'Department that owns this contract' },
    { field: 'terms_and_conditions', label: 'Terms & Conditions', type: 'string', maxLength: 8000, description: 'Full terms and conditions text' },
    { field: 'renewal_options', label: 'Renewal Options', type: 'string', maxLength: 1000, description: 'Available renewal options and terms' },
  ],

  purchase_orders: [
    { field: 'number', label: 'PO Number', type: 'string', required: true, maxLength: 40, description: 'Unique purchase order number' },
    { field: 'short_description', label: 'Description', type: 'string', maxLength: 200, description: 'Brief description of the purchase' },
    { field: 'vendor', label: 'Vendor', type: 'reference', reference: 'core_company', required: true, description: 'Vendor supplying the goods/services' },
    { field: 'requested_by', label: 'Requested By', type: 'reference', reference: 'sys_user', description: 'User who requested this purchase' },
    { field: 'state', label: 'State', type: 'choice', description: 'Current state of the PO', choices: [
      { value: 'draft', label: 'Draft' },
      { value: 'pending_approval', label: 'Pending Approval' },
      { value: 'approved', label: 'Approved' },
      { value: 'ordered', label: 'Ordered' },
      { value: 'received', label: 'Received' },
      { value: 'closed', label: 'Closed' },
      { value: 'cancelled', label: 'Cancelled' },
    ]},
    { field: 'ordered', label: 'Order Date', type: 'date', description: 'Date the PO was sent to vendor' },
    { field: 'expected_delivery', label: 'Expected Delivery', type: 'date', description: 'Expected delivery date' },
    { field: 'received', label: 'Received Date', type: 'date', description: 'Date goods/services were received' },
    { field: 'subtotal', label: 'Subtotal', type: 'currency', description: 'Total before tax' },
    { field: 'tax', label: 'Tax', type: 'currency', description: 'Tax amount' },
    { field: 'total', label: 'Total', type: 'currency', description: 'Total including tax' },
    { field: 'ship_to', label: 'Ship To', type: 'reference', reference: 'cmn_location', description: 'Delivery location' },
    { field: 'bill_to', label: 'Bill To', type: 'reference', reference: 'cmn_location', description: 'Billing address' },
    { field: 'payment_terms', label: 'Payment Terms', type: 'string', maxLength: 100, description: 'Payment terms for this order' },
    { field: 'special_instructions', label: 'Special Instructions', type: 'string', maxLength: 2000, description: 'Special handling or delivery instructions' },
  ],
};

/**
 * Get field metadata for a specific table and field
 */
export function getFieldMetadata(viewType: TableViewType, field: string): FieldMetadata | undefined {
  // Check table-specific fields first
  const tableFields = FIELD_METADATA[viewType];
  const fieldMeta = tableFields?.find((f) => f.field === field);
  if (fieldMeta) return fieldMeta;

  // Check common fields
  const commonMeta = COMMON_FIELDS[field];
  if (commonMeta) {
    return {
      field,
      label: field.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
      ...commonMeta,
    };
  }

  return undefined;
}

/**
 * Get all field metadata for a table
 */
export function getAllFieldMetadata(viewType: TableViewType): FieldMetadata[] {
  return FIELD_METADATA[viewType] || [];
}

/**
 * Get required fields for a table
 */
export function getRequiredFields(viewType: TableViewType): string[] {
  return (FIELD_METADATA[viewType] || [])
    .filter((f) => f.required)
    .map((f) => f.field);
}
