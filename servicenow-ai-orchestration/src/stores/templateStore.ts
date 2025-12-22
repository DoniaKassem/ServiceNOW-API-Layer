import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { TableViewType } from '../types';

export interface RecordTemplate {
  id: string;
  name: string;
  description?: string;
  viewType: TableViewType;
  fields: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

interface TemplateState {
  templates: RecordTemplate[];

  // Actions
  addTemplate: (template: Omit<RecordTemplate, 'id' | 'createdAt' | 'updatedAt'>) => RecordTemplate;
  updateTemplate: (id: string, updates: Partial<Omit<RecordTemplate, 'id' | 'createdAt'>>) => void;
  deleteTemplate: (id: string) => void;
  getTemplatesForView: (viewType: TableViewType) => RecordTemplate[];
  getTemplateById: (id: string) => RecordTemplate | undefined;
  duplicateTemplate: (id: string, newName: string) => RecordTemplate | undefined;
}

export const useTemplateStore = create<TemplateState>()(
  persist(
    (set, get) => ({
      templates: [],

      addTemplate: (template) => {
        const now = new Date().toISOString();
        const newTemplate: RecordTemplate = {
          ...template,
          id: Math.random().toString(36).substring(2, 11),
          createdAt: now,
          updatedAt: now,
        };

        set((state) => ({
          templates: [...state.templates, newTemplate],
        }));

        return newTemplate;
      },

      updateTemplate: (id, updates) => {
        set((state) => ({
          templates: state.templates.map((t) =>
            t.id === id
              ? { ...t, ...updates, updatedAt: new Date().toISOString() }
              : t
          ),
        }));
      },

      deleteTemplate: (id) => {
        set((state) => ({
          templates: state.templates.filter((t) => t.id !== id),
        }));
      },

      getTemplatesForView: (viewType) => {
        return get().templates.filter((t) => t.viewType === viewType);
      },

      getTemplateById: (id) => {
        return get().templates.find((t) => t.id === id);
      },

      duplicateTemplate: (id, newName) => {
        const original = get().getTemplateById(id);
        if (!original) return undefined;

        return get().addTemplate({
          name: newName,
          description: original.description,
          viewType: original.viewType,
          fields: { ...original.fields },
        });
      },
    }),
    {
      name: 'servicenow-templates',
    }
  )
);
