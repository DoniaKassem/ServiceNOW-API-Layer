import { getFieldMetadata, getAllFieldMetadata } from '../config/fieldMetadata';
import type { TableViewType } from '../types';

export interface ValidationError {
  field: string;
  message: string;
}

export interface ValidationResult {
  isValid: boolean;
  errors: ValidationError[];
}

/**
 * Validate a single field value
 */
export function validateField(
  viewType: TableViewType,
  field: string,
  value: unknown
): ValidationError | null {
  const metadata = getFieldMetadata(viewType, field);
  if (!metadata) return null;

  // Required check
  if (metadata.required && (value === null || value === undefined || value === '')) {
    return {
      field,
      message: `${metadata.label} is required`,
    };
  }

  // Skip other validations if empty and not required
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const stringValue = String(value);

  // Max length check
  if (metadata.maxLength && stringValue.length > metadata.maxLength) {
    return {
      field,
      message: `${metadata.label} must be ${metadata.maxLength} characters or less`,
    };
  }

  // Pattern check
  if (metadata.pattern && !metadata.pattern.test(stringValue)) {
    return {
      field,
      message: metadata.patternMessage || `${metadata.label} format is invalid`,
    };
  }

  // Type-specific validation
  switch (metadata.type) {
    case 'email':
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(stringValue)) {
        return {
          field,
          message: `${metadata.label} must be a valid email address`,
        };
      }
      break;

    case 'url':
      if (!/^https?:\/\/.+/.test(stringValue)) {
        return {
          field,
          message: `${metadata.label} must be a valid URL`,
        };
      }
      break;

    case 'integer':
      if (!/^-?\d+$/.test(stringValue)) {
        return {
          field,
          message: `${metadata.label} must be a whole number`,
        };
      }
      if (metadata.min !== undefined && parseInt(stringValue, 10) < metadata.min) {
        return {
          field,
          message: `${metadata.label} must be at least ${metadata.min}`,
        };
      }
      if (metadata.max !== undefined && parseInt(stringValue, 10) > metadata.max) {
        return {
          field,
          message: `${metadata.label} must be at most ${metadata.max}`,
        };
      }
      break;

    case 'decimal':
    case 'currency':
      if (!/^-?\d+(\.\d+)?$/.test(stringValue)) {
        return {
          field,
          message: `${metadata.label} must be a valid number`,
        };
      }
      break;

    case 'phone':
      // Basic phone validation - allows various formats
      if (!/^[\d\s\-\+\(\)\.]+$/.test(stringValue) || stringValue.replace(/\D/g, '').length < 7) {
        return {
          field,
          message: `${metadata.label} must be a valid phone number`,
        };
      }
      break;

    case 'date':
    case 'datetime':
      if (isNaN(Date.parse(stringValue))) {
        return {
          field,
          message: `${metadata.label} must be a valid date`,
        };
      }
      break;
  }

  return null;
}

/**
 * Validate all fields in a form
 */
export function validateForm(
  viewType: TableViewType,
  formData: Record<string, unknown>
): ValidationResult {
  const errors: ValidationError[] = [];
  const metadata = getAllFieldMetadata(viewType);

  // Check all defined fields
  for (const fieldMeta of metadata) {
    const error = validateField(viewType, fieldMeta.field, formData[fieldMeta.field]);
    if (error) {
      errors.push(error);
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

/**
 * Get validation errors as a map for easy lookup
 */
export function getErrorMap(errors: ValidationError[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const error of errors) {
    if (!map[error.field]) {
      map[error.field] = error.message;
    }
  }
  return map;
}

/**
 * Hook for form validation state
 */
import { useState, useCallback } from 'react';

export function useFormValidation(viewType: TableViewType) {
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [touched, setTouched] = useState<Set<string>>(new Set());

  const validateSingleField = useCallback(
    (field: string, value: unknown) => {
      const error = validateField(viewType, field, value);
      setErrors((prev) => {
        const next = { ...prev };
        if (error) {
          next[field] = error.message;
        } else {
          delete next[field];
        }
        return next;
      });
      return error === null;
    },
    [viewType]
  );

  const validateAllFields = useCallback(
    (formData: Record<string, unknown>) => {
      const result = validateForm(viewType, formData);
      setErrors(getErrorMap(result.errors));
      // Mark all fields as touched
      const allFields = new Set(Object.keys(formData));
      result.errors.forEach((e) => allFields.add(e.field));
      setTouched(allFields);
      return result.isValid;
    },
    [viewType]
  );

  const markTouched = useCallback((field: string) => {
    setTouched((prev) => new Set(prev).add(field));
  }, []);

  const clearErrors = useCallback(() => {
    setErrors({});
    setTouched(new Set());
  }, []);

  const getFieldError = useCallback(
    (field: string): string | undefined => {
      return touched.has(field) ? errors[field] : undefined;
    },
    [errors, touched]
  );

  return {
    errors,
    touched,
    validateSingleField,
    validateAllFields,
    markTouched,
    clearErrors,
    getFieldError,
    hasErrors: Object.keys(errors).length > 0,
  };
}
