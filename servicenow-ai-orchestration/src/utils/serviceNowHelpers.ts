/**
 * ServiceNow field value helper utilities
 * Handles reference fields that return {display_value, value} objects
 */

export interface ReferenceField {
  display_value?: string;
  value?: string;
  link?: string;
}

/**
 * Extracts the sys_id value from a ServiceNow field
 * Handles both simple strings and reference objects {display_value, value}
 */
export function getSysId(field: unknown): string {
  if (!field) return '';

  if (typeof field === 'string') {
    return field;
  }

  if (typeof field === 'object' && field !== null) {
    const ref = field as ReferenceField;
    return ref.value || '';
  }

  return String(field);
}

/**
 * Extracts the display value from a ServiceNow field
 * For reference fields, returns display_value; for strings, returns as-is
 */
export function getDisplayValue(field: unknown): string {
  if (!field) return '';

  if (typeof field === 'string') {
    return field;
  }

  if (typeof field === 'object' && field !== null) {
    const ref = field as ReferenceField;
    return ref.display_value || ref.value || '';
  }

  return String(field);
}

/**
 * Safely converts any ServiceNow field value to a string for display
 * Handles primitives, reference objects, and null/undefined
 */
export function fieldToString(field: unknown): string {
  if (field === null || field === undefined) {
    return '';
  }

  if (typeof field === 'string') {
    return field;
  }

  if (typeof field === 'number' || typeof field === 'boolean') {
    return String(field);
  }

  if (typeof field === 'object') {
    const ref = field as ReferenceField;
    return ref.display_value || ref.value || JSON.stringify(field);
  }

  return String(field);
}

/**
 * Checks if a field is a reference object
 */
export function isReferenceField(field: unknown): field is ReferenceField {
  return (
    typeof field === 'object' &&
    field !== null &&
    ('display_value' in field || 'value' in field)
  );
}

/**
 * Gets a safe key for React from a ServiceNow field
 * Ensures we get a string even if the field is a reference object
 */
export function getFieldKey(field: unknown, fallback: string | number): string {
  const sysId = getSysId(field);
  return sysId || String(fallback);
}

/**
 * Extracts the first non-null display name from a record
 * Handles reference fields for common name fields
 */
export function getRecordDisplayName(record: Record<string, unknown>): string {
  const nameFields = ['name', 'number', 'display_name', 'short_description', 'sys_id'];

  for (const field of nameFields) {
    const value = record[field];
    if (value) {
      return getDisplayValue(value);
    }
  }

  return 'Unknown';
}
