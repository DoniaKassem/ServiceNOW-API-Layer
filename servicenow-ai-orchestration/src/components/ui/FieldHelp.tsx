import { useState, useRef, useEffect } from 'react';
import { HelpCircle } from 'lucide-react';
import { clsx } from 'clsx';

interface FieldHelpProps {
  label: string;
  description?: string;
  fieldType?: string;
  maxLength?: number;
  required?: boolean;
  reference?: string;
  className?: string;
}

export function FieldHelp({
  label,
  description,
  fieldType,
  maxLength,
  required,
  reference,
  className,
}: FieldHelpProps) {
  const [isVisible, setIsVisible] = useState(false);
  const [position, setPosition] = useState<'top' | 'bottom'>('top');
  const triggerRef = useRef<HTMLButtonElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isVisible && triggerRef.current && tooltipRef.current) {
      const triggerRect = triggerRef.current.getBoundingClientRect();
      const tooltipHeight = tooltipRef.current.offsetHeight;
      const spaceAbove = triggerRect.top;
      const spaceBelow = window.innerHeight - triggerRect.bottom;

      // Position tooltip based on available space
      if (spaceAbove < tooltipHeight + 10 && spaceBelow > spaceAbove) {
        setPosition('bottom');
      } else {
        setPosition('top');
      }
    }
  }, [isVisible]);

  const hasContent = description || fieldType || maxLength || reference;

  if (!hasContent) return null;

  return (
    <div className={clsx('relative inline-flex', className)}>
      <button
        ref={triggerRef}
        type="button"
        onMouseEnter={() => setIsVisible(true)}
        onMouseLeave={() => setIsVisible(false)}
        onFocus={() => setIsVisible(true)}
        onBlur={() => setIsVisible(false)}
        className="p-0.5 text-gray-400 hover:text-gray-600 focus:outline-none focus:text-blue-500 transition-colors"
        aria-label={`Help for ${label}`}
      >
        <HelpCircle className="w-4 h-4" />
      </button>

      {isVisible && (
        <div
          ref={tooltipRef}
          role="tooltip"
          className={clsx(
            'absolute z-50 w-64 p-3 bg-gray-900 text-white text-sm rounded-lg shadow-lg',
            'animate-fade-in',
            position === 'top' && 'bottom-full mb-2 left-1/2 -translate-x-1/2',
            position === 'bottom' && 'top-full mt-2 left-1/2 -translate-x-1/2'
          )}
        >
          {/* Arrow */}
          <div
            className={clsx(
              'absolute w-2 h-2 bg-gray-900 rotate-45',
              position === 'top' && 'bottom-[-4px] left-1/2 -translate-x-1/2',
              position === 'bottom' && 'top-[-4px] left-1/2 -translate-x-1/2'
            )}
          />

          {/* Content */}
          <div className="relative space-y-2">
            <p className="font-medium text-white">{label}</p>

            {description && (
              <p className="text-gray-300 text-xs leading-relaxed">{description}</p>
            )}

            <div className="flex flex-wrap gap-2 pt-1">
              {fieldType && (
                <span className="inline-flex items-center px-2 py-0.5 text-xs bg-gray-700 rounded">
                  {fieldType}
                </span>
              )}
              {maxLength && (
                <span className="inline-flex items-center px-2 py-0.5 text-xs bg-gray-700 rounded">
                  Max: {maxLength}
                </span>
              )}
              {required && (
                <span className="inline-flex items-center px-2 py-0.5 text-xs bg-red-600 rounded">
                  Required
                </span>
              )}
              {reference && (
                <span className="inline-flex items-center px-2 py-0.5 text-xs bg-blue-600 rounded">
                  Ref: {reference}
                </span>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Field label with integrated help
interface FieldLabelProps {
  label: string;
  htmlFor?: string;
  required?: boolean;
  description?: string;
  fieldType?: string;
  maxLength?: number;
  reference?: string;
  className?: string;
}

export function FieldLabel({
  label,
  htmlFor,
  required,
  description,
  fieldType,
  maxLength,
  reference,
  className,
}: FieldLabelProps) {
  return (
    <div className={clsx('flex items-center gap-1.5', className)}>
      <label
        htmlFor={htmlFor}
        className="block text-sm font-medium text-gray-700"
      >
        {label}
        {required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      <FieldHelp
        label={label}
        description={description}
        fieldType={fieldType}
        maxLength={maxLength}
        required={required}
        reference={reference}
      />
    </div>
  );
}

// Add animation styles
const style = document.createElement('style');
style.textContent = `
  @keyframes fade-in {
    from {
      opacity: 0;
      transform: translateX(-50%) translateY(4px);
    }
    to {
      opacity: 1;
      transform: translateX(-50%) translateY(0);
    }
  }
  .animate-fade-in {
    animation: fade-in 0.15s ease-out;
  }
`;
if (!document.querySelector('[data-field-help-styles]')) {
  style.setAttribute('data-field-help-styles', 'true');
  document.head.appendChild(style);
}
