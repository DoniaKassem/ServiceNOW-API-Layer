import { useState } from 'react';
import {
  X,
  FileText,
  Plus,
  Trash2,
  Edit3,
  Copy,
  Check,
  Clock,
  MoreVertical,
} from 'lucide-react';
import { clsx } from 'clsx';
import { format } from 'date-fns';
import { useTemplateStore, type RecordTemplate } from '../../stores/templateStore';
import { TABLE_VIEW_CONFIG, type TableViewType } from '../../types';

interface TemplateManagerModalProps {
  viewType: TableViewType;
  onClose: () => void;
  onApplyTemplate: (template: RecordTemplate) => void;
  currentFormData?: Record<string, unknown>;
}

export function TemplateManagerModal({
  viewType,
  onClose,
  onApplyTemplate,
  currentFormData,
}: TemplateManagerModalProps) {
  const config = TABLE_VIEW_CONFIG[viewType];
  const { addTemplate, updateTemplate, deleteTemplate, duplicateTemplate, getTemplatesForView } =
    useTemplateStore();

  const viewTemplates = getTemplatesForView(viewType);
  const [showSaveForm, setShowSaveForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState({ name: '', description: '' });
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);

  const handleSaveTemplate = () => {
    if (!formData.name.trim() || !currentFormData) return;

    // Filter out empty values and system fields
    const fieldsToSave: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(currentFormData)) {
      if (
        value !== null &&
        value !== undefined &&
        value !== '' &&
        !key.startsWith('sys_')
      ) {
        fieldsToSave[key] = value;
      }
    }

    if (editingId) {
      updateTemplate(editingId, {
        name: formData.name,
        description: formData.description,
        fields: fieldsToSave,
      });
    } else {
      addTemplate({
        name: formData.name,
        description: formData.description,
        viewType,
        fields: fieldsToSave,
      });
    }

    setFormData({ name: '', description: '' });
    setShowSaveForm(false);
    setEditingId(null);
  };

  const handleEditTemplate = (template: RecordTemplate) => {
    setEditingId(template.id);
    setFormData({ name: template.name, description: template.description || '' });
    setShowSaveForm(true);
    setMenuOpenId(null);
  };

  const handleDuplicateTemplate = (template: RecordTemplate) => {
    duplicateTemplate(template.id, `${template.name} (Copy)`);
    setMenuOpenId(null);
  };

  const handleDeleteTemplate = (id: string) => {
    if (confirm('Are you sure you want to delete this template?')) {
      deleteTemplate(id);
    }
    setMenuOpenId(null);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />

      {/* Modal */}
      <div className="relative bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-purple-100 rounded-lg">
              <FileText className="w-5 h-5 text-purple-600" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Record Templates</h2>
              <p className="text-sm text-gray-500">
                Save and apply templates for {config.label.toLowerCase()}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {/* Save New Template Form */}
          {showSaveForm && currentFormData && (
            <div className="mb-6 p-4 bg-gray-50 rounded-lg border border-gray-200">
              <h3 className="text-sm font-medium text-gray-900 mb-3">
                {editingId ? 'Edit Template' : 'Save Current Form as Template'}
              </h3>
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">
                    Template Name *
                  </label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    placeholder="e.g., Standard Contract"
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">
                    Description
                  </label>
                  <textarea
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    placeholder="Describe when to use this template..."
                    rows={2}
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                  />
                </div>
                <div className="flex items-center justify-end gap-2 pt-2">
                  <button
                    onClick={() => {
                      setShowSaveForm(false);
                      setEditingId(null);
                      setFormData({ name: '', description: '' });
                    }}
                    className="px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-200 rounded-lg"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSaveTemplate}
                    disabled={!formData.name.trim()}
                    className={clsx(
                      'flex items-center gap-2 px-3 py-1.5 text-sm font-medium rounded-lg',
                      formData.name.trim()
                        ? 'bg-purple-600 text-white hover:bg-purple-700'
                        : 'bg-gray-100 text-gray-400 cursor-not-allowed'
                    )}
                  >
                    <Check className="w-4 h-4" />
                    {editingId ? 'Update' : 'Save'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Save Template Button */}
          {!showSaveForm && currentFormData && (
            <button
              onClick={() => setShowSaveForm(true)}
              className="w-full mb-6 flex items-center justify-center gap-2 px-4 py-3 text-sm text-purple-600 border-2 border-dashed border-purple-300 rounded-lg hover:bg-purple-50 transition-colors"
            >
              <Plus className="w-4 h-4" />
              Save Current Form as Template
            </button>
          )}

          {/* Template List */}
          {viewTemplates.length === 0 ? (
            <div className="text-center py-8">
              <FileText className="w-12 h-12 text-gray-300 mx-auto mb-3" />
              <p className="text-sm text-gray-500">No templates saved yet</p>
              <p className="text-xs text-gray-400 mt-1">
                Fill out a form and save it as a template for quick reuse
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {viewTemplates.map((template) => (
                <div
                  key={template.id}
                  className="group flex items-center justify-between p-4 bg-white border border-gray-200 rounded-lg hover:border-purple-300 hover:shadow-sm transition-all"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h4 className="text-sm font-medium text-gray-900">{template.name}</h4>
                      <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded">
                        {Object.keys(template.fields).length} fields
                      </span>
                    </div>
                    {template.description && (
                      <p className="text-xs text-gray-500 mt-1 truncate">
                        {template.description}
                      </p>
                    )}
                    <div className="flex items-center gap-2 mt-2 text-xs text-gray-400">
                      <Clock className="w-3 h-3" />
                      <span>Updated {format(new Date(template.updatedAt), 'MMM d, yyyy')}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => onApplyTemplate(template)}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-white bg-purple-600 hover:bg-purple-700 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <Check className="w-4 h-4" />
                      Apply
                    </button>

                    {/* Menu */}
                    <div className="relative">
                      <button
                        onClick={() => setMenuOpenId(menuOpenId === template.id ? null : template.id)}
                        className="p-1.5 hover:bg-gray-100 rounded-lg"
                      >
                        <MoreVertical className="w-4 h-4 text-gray-400" />
                      </button>

                      {menuOpenId === template.id && (
                        <div className="absolute right-0 mt-1 w-40 bg-white rounded-lg shadow-lg border border-gray-200 z-10 py-1">
                          <button
                            onClick={() => handleEditTemplate(template)}
                            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
                          >
                            <Edit3 className="w-4 h-4" />
                            Edit
                          </button>
                          <button
                            onClick={() => handleDuplicateTemplate(template)}
                            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
                          >
                            <Copy className="w-4 h-4" />
                            Duplicate
                          </button>
                          <hr className="my-1 border-gray-200" />
                          <button
                            onClick={() => handleDeleteTemplate(template.id)}
                            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-red-50"
                          >
                            <Trash2 className="w-4 h-4" />
                            Delete
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end px-6 py-4 border-t border-gray-200 bg-gray-50">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

// Template selector dropdown for forms
interface TemplateSelectorProps {
  viewType: TableViewType;
  onSelect: (template: RecordTemplate) => void;
}

export function TemplateSelector({ viewType, onSelect }: TemplateSelectorProps) {
  const { getTemplatesForView } = useTemplateStore();
  const [isOpen, setIsOpen] = useState(false);
  const templates = getTemplatesForView(viewType);

  if (templates.length === 0) return null;

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-3 py-1.5 text-sm text-purple-600 hover:bg-purple-50 rounded-lg border border-purple-200"
      >
        <FileText className="w-4 h-4" />
        Apply Template
      </button>

      {isOpen && (
        <>
          <div
            className="fixed inset-0 z-10"
            onClick={() => setIsOpen(false)}
          />
          <div className="absolute right-0 mt-1 w-64 bg-white rounded-lg shadow-lg border border-gray-200 z-20 py-1 max-h-64 overflow-y-auto">
            {templates.map((template) => (
              <button
                key={template.id}
                onClick={() => {
                  onSelect(template);
                  setIsOpen(false);
                }}
                className="w-full text-left px-3 py-2 hover:bg-gray-50"
              >
                <p className="text-sm font-medium text-gray-900">{template.name}</p>
                {template.description && (
                  <p className="text-xs text-gray-500 truncate">{template.description}</p>
                )}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
