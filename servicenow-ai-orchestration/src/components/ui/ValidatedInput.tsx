import { forwardRef, type InputHTMLAttributes, type SelectHTMLAttributes } from 'react';
import { AlertCircle } from 'lucide-react';
import { clsx } from 'clsx';
import { FieldLabel } from './FieldHelp';
import type { FieldMetadata } from '../../config/fieldMetadata';

interface BaseInputProps {
  label: string;
  error?: string;
  touched?: boolean;
  fieldMetadata?: FieldMetadata;
  containerClassName?: string;
}

type ValidatedInputProps = BaseInputProps &
  Omit<InputHTMLAttributes<HTMLInputElement>, 'className'> & {
    inputClassName?: string;
  };

export const ValidatedInput = forwardRef<HTMLInputElement, ValidatedInputProps>(
  function ValidatedInput(
    {
      label,
      error,
      touched,
      fieldMetadata,
      containerClassName,
      inputClassName,
      id,
      required,
      onBlur,
      ...props
    },
    ref
  ) {
    const inputId = id || props.name || label.toLowerCase().replace(/\s+/g, '-');
    const showError = touched && error;
    const isRequired = required ?? fieldMetadata?.required;

    return (
      <div className={clsx('space-y-1', containerClassName)}>
        <FieldLabel
          label={label}
          htmlFor={inputId}
          required={isRequired}
          description={fieldMetadata?.description}
          fieldType={fieldMetadata?.type}
          maxLength={fieldMetadata?.maxLength}
          reference={fieldMetadata?.reference}
        />
        <div className="relative">
          <input
            ref={ref}
            id={inputId}
            className={clsx(
              'w-full px-3 py-2 border rounded-lg transition-colors',
              'focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none',
              showError
                ? 'border-red-300 bg-red-50 focus:ring-red-500 focus:border-red-500'
                : 'border-gray-300',
              inputClassName
            )}
            aria-invalid={showError ? 'true' : undefined}
            aria-describedby={showError ? `${inputId}-error` : undefined}
            required={isRequired}
            maxLength={fieldMetadata?.maxLength}
            onBlur={onBlur}
            {...props}
          />
          {showError && (
            <div className="absolute right-3 top-1/2 -translate-y-1/2">
              <AlertCircle className="w-5 h-5 text-red-500" />
            </div>
          )}
        </div>
        {showError && (
          <p id={`${inputId}-error`} className="text-sm text-red-600 flex items-center gap-1">
            {error}
          </p>
        )}
      </div>
    );
  }
);

type ValidatedSelectProps = BaseInputProps &
  Omit<SelectHTMLAttributes<HTMLSelectElement>, 'className'> & {
    selectClassName?: string;
    options: { value: string; label: string }[];
    placeholder?: string;
  };

export const ValidatedSelect = forwardRef<HTMLSelectElement, ValidatedSelectProps>(
  function ValidatedSelect(
    {
      label,
      error,
      touched,
      fieldMetadata,
      containerClassName,
      selectClassName,
      id,
      required,
      options,
      placeholder,
      onBlur,
      ...props
    },
    ref
  ) {
    const selectId = id || props.name || label.toLowerCase().replace(/\s+/g, '-');
    const showError = touched && error;
    const isRequired = required ?? fieldMetadata?.required;

    // Use choices from field metadata if available
    const selectOptions = fieldMetadata?.choices || options;

    return (
      <div className={clsx('space-y-1', containerClassName)}>
        <FieldLabel
          label={label}
          htmlFor={selectId}
          required={isRequired}
          description={fieldMetadata?.description}
          fieldType={fieldMetadata?.type}
          reference={fieldMetadata?.reference}
        />
        <div className="relative">
          <select
            ref={ref}
            id={selectId}
            className={clsx(
              'w-full px-3 py-2 border rounded-lg transition-colors appearance-none bg-white',
              'focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none',
              showError
                ? 'border-red-300 bg-red-50 focus:ring-red-500 focus:border-red-500'
                : 'border-gray-300',
              selectClassName
            )}
            aria-invalid={showError ? 'true' : undefined}
            aria-describedby={showError ? `${selectId}-error` : undefined}
            required={isRequired}
            onBlur={onBlur}
            {...props}
          >
            {placeholder && (
              <option value="">{placeholder}</option>
            )}
            {selectOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          {/* Dropdown arrow */}
          <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none">
            <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </div>
        </div>
        {showError && (
          <p id={`${selectId}-error`} className="text-sm text-red-600 flex items-center gap-1">
            {error}
          </p>
        )}
      </div>
    );
  }
);

interface ValidatedTextareaProps extends BaseInputProps {
  value?: string;
  onChange?: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  onBlur?: (e: React.FocusEvent<HTMLTextAreaElement>) => void;
  rows?: number;
  placeholder?: string;
  textareaClassName?: string;
  name?: string;
  disabled?: boolean;
}

export const ValidatedTextarea = forwardRef<HTMLTextAreaElement, ValidatedTextareaProps>(
  function ValidatedTextarea(
    {
      label,
      error,
      touched,
      fieldMetadata,
      containerClassName,
      textareaClassName,
      rows = 3,
      name,
      ...props
    },
    ref
  ) {
    const textareaId = name || label.toLowerCase().replace(/\s+/g, '-');
    const showError = touched && error;
    const isRequired = fieldMetadata?.required;

    return (
      <div className={clsx('space-y-1', containerClassName)}>
        <FieldLabel
          label={label}
          htmlFor={textareaId}
          required={isRequired}
          description={fieldMetadata?.description}
          fieldType={fieldMetadata?.type}
          maxLength={fieldMetadata?.maxLength}
        />
        <div className="relative">
          <textarea
            ref={ref}
            id={textareaId}
            name={name}
            rows={rows}
            className={clsx(
              'w-full px-3 py-2 border rounded-lg transition-colors resize-y',
              'focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none',
              showError
                ? 'border-red-300 bg-red-50 focus:ring-red-500 focus:border-red-500'
                : 'border-gray-300',
              textareaClassName
            )}
            aria-invalid={showError ? 'true' : undefined}
            aria-describedby={showError ? `${textareaId}-error` : undefined}
            maxLength={fieldMetadata?.maxLength}
            {...props}
          />
        </div>
        {fieldMetadata?.maxLength && props.value && (
          <p className="text-xs text-gray-400 text-right">
            {props.value.length} / {fieldMetadata.maxLength}
          </p>
        )}
        {showError && (
          <p id={`${textareaId}-error`} className="text-sm text-red-600 flex items-center gap-1">
            {error}
          </p>
        )}
      </div>
    );
  }
);
