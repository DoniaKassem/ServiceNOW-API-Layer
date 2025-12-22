import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { v4 as uuidv4 } from 'uuid';
import type {
  TableViewType,
  ColumnConfig,
  FilterCondition,
} from '../types';

// Helper to convert field name to label
function fieldToLabel(field: string): string {
  return field
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

interface TableViewPreferences {
  columns: ColumnConfig[];
  pageSize: number;
  savedFilters: {
    id: string;
    name: string;
    filters: FilterCondition[];
  }[];
}

interface TableViewState {
  // Per-table preferences
  preferences: Record<TableViewType, TableViewPreferences>;

  // Current view state (not persisted)
  currentView: TableViewType | null;
  currentPage: number;
  searchQuery: string;
  activeFilters: FilterCondition[];
  sortField: string | null;
  sortDirection: 'asc' | 'desc';
  selectedRows: string[];
  editingCells: Map<string, string>; // rowId-field -> original value
  pendingChanges: Map<string, Record<string, unknown>>; // rowId -> changes

  // Actions - View management
  setCurrentView: (view: TableViewType) => void;
  setCurrentPage: (page: number) => void;
  setSearchQuery: (query: string) => void;
  setSortField: (field: string | null) => void;
  toggleSortDirection: () => void;

  // Actions - Column management
  setColumns: (view: TableViewType, columns: ColumnConfig[]) => void;
  toggleColumnVisibility: (view: TableViewType, field: string) => void;
  reorderColumns: (view: TableViewType, fromIndex: number, toIndex: number) => void;
  resetColumnsToDefault: (view: TableViewType) => void;
  updateAvailableColumns: (view: TableViewType, availableFields: string[]) => void;

  // Actions - Filter management
  setActiveFilters: (filters: FilterCondition[]) => void;
  addFilter: (filter: Omit<FilterCondition, 'id'>) => void;
  updateFilter: (id: string, updates: Partial<FilterCondition>) => void;
  removeFilter: (id: string) => void;
  clearFilters: () => void;
  saveFilterSet: (view: TableViewType, name: string) => void;
  loadFilterSet: (view: TableViewType, filterId: string) => void;
  deleteFilterSet: (view: TableViewType, filterId: string) => void;

  // Actions - Row selection
  setSelectedRows: (rows: string[]) => void;
  toggleRowSelection: (rowId: string) => void;
  selectAllRows: (rowIds: string[]) => void;
  clearSelection: () => void;

  // Actions - Inline editing
  startEditing: (rowId: string, field: string, originalValue: string) => void;
  cancelEditing: (rowId: string, field: string) => void;
  commitEdit: (rowId: string, field: string, newValue: unknown) => void;
  discardAllChanges: () => void;
  getPendingChanges: () => Map<string, Record<string, unknown>>;
  hasPendingChanges: () => boolean;

  // Actions - Page size
  setPageSize: (view: TableViewType, size: number) => void;

  // Helpers
  getVisibleColumns: (view: TableViewType) => ColumnConfig[];
  buildQueryString: () => string;
}

// Default columns by table type
const DEFAULT_COLUMN_SETS: Record<TableViewType, string[]> = {
  contracts: [
    'number', 'short_description', 'vendor', 'supplier', 'starts', 'ends',
    'state', 'payment_amount', 'payment_schedule', 'total_cost',
  ],
  purchase_orders: [
    'display_name', 'status', 'supplier', 'total_amount', 'purchase_order_type', 'created',
  ],
  suppliers: [
    'name', 'legal_name', 'u_vendor', 'web_site', 'city', 'state', 'country',
  ],
  vendors: [
    'name', 'status', 'vendor_type', 'vendor_manager', 'website', 'city', 'state', 'country',
  ],
};

// Default page size options - increased from 25 to 100 for better usability
export const PAGE_SIZE_OPTIONS = [25, 50, 100, 250, 500, 1000] as const;

function createDefaultPreferences(view: TableViewType): TableViewPreferences {
  const defaultFields = DEFAULT_COLUMN_SETS[view];
  return {
    columns: defaultFields.map((field, index) => ({
      field,
      label: fieldToLabel(field),
      visible: true,
      order: index,
    })),
    pageSize: 100, // Increased default from 25 to 100
    savedFilters: [],
  };
}

const initialPreferences: Record<TableViewType, TableViewPreferences> = {
  contracts: createDefaultPreferences('contracts'),
  purchase_orders: createDefaultPreferences('purchase_orders'),
  suppliers: createDefaultPreferences('suppliers'),
  vendors: createDefaultPreferences('vendors'),
};

export const useTableViewStore = create<TableViewState>()(
  persist(
    (set, get) => ({
      preferences: initialPreferences,
      currentView: null,
      currentPage: 1,
      searchQuery: '',
      activeFilters: [],
      sortField: null,
      sortDirection: 'desc',
      selectedRows: [],
      editingCells: new Map(),
      pendingChanges: new Map(),

      setCurrentView: (view) => {
        set({
          currentView: view,
          currentPage: 1,
          searchQuery: '',
          activeFilters: [],
          selectedRows: [],
          editingCells: new Map(),
          pendingChanges: new Map(),
        });
      },

      setCurrentPage: (page) => set({ currentPage: page }),

      setSearchQuery: (query) => set({ searchQuery: query, currentPage: 1 }),

      setSortField: (field) => set({ sortField: field }),

      toggleSortDirection: () =>
        set((state) => ({
          sortDirection: state.sortDirection === 'asc' ? 'desc' : 'asc',
        })),

      setColumns: (view, columns) =>
        set((state) => ({
          preferences: {
            ...state.preferences,
            [view]: { ...state.preferences[view], columns },
          },
        })),

      toggleColumnVisibility: (view, field) =>
        set((state) => ({
          preferences: {
            ...state.preferences,
            [view]: {
              ...state.preferences[view],
              columns: state.preferences[view].columns.map((col) =>
                col.field === field ? { ...col, visible: !col.visible } : col
              ),
            },
          },
        })),

      reorderColumns: (view, fromIndex, toIndex) =>
        set((state) => {
          const columns = [...state.preferences[view].columns];
          const [removed] = columns.splice(fromIndex, 1);
          columns.splice(toIndex, 0, removed);
          // Update order numbers
          const reorderedColumns = columns.map((col, index) => ({
            ...col,
            order: index,
          }));
          return {
            preferences: {
              ...state.preferences,
              [view]: { ...state.preferences[view], columns: reorderedColumns },
            },
          };
        }),

      resetColumnsToDefault: (view) =>
        set((state) => ({
          preferences: {
            ...state.preferences,
            [view]: {
              ...state.preferences[view],
              columns: createDefaultPreferences(view).columns,
            },
          },
        })),

      updateAvailableColumns: (view, availableFields) =>
        set((state) => {
          const existingColumns = state.preferences[view].columns;
          const existingFields = new Set(existingColumns.map((c) => c.field));
          const defaultVisible = new Set(DEFAULT_COLUMN_SETS[view]);

          // Add new fields that don't exist yet
          const newColumns = availableFields
            .filter((field) => !existingFields.has(field))
            .map((field, index) => ({
              field,
              label: fieldToLabel(field),
              visible: defaultVisible.has(field),
              order: existingColumns.length + index,
            }));

          return {
            preferences: {
              ...state.preferences,
              [view]: {
                ...state.preferences[view],
                columns: [...existingColumns, ...newColumns],
              },
            },
          };
        }),

      setActiveFilters: (filters) => set({ activeFilters: filters, currentPage: 1 }),

      addFilter: (filter) =>
        set((state) => ({
          activeFilters: [...state.activeFilters, { ...filter, id: uuidv4() }],
          currentPage: 1,
        })),

      updateFilter: (id, updates) =>
        set((state) => ({
          activeFilters: state.activeFilters.map((f) =>
            f.id === id ? { ...f, ...updates } : f
          ),
          currentPage: 1,
        })),

      removeFilter: (id) =>
        set((state) => ({
          activeFilters: state.activeFilters.filter((f) => f.id !== id),
          currentPage: 1,
        })),

      clearFilters: () => set({ activeFilters: [], currentPage: 1 }),

      saveFilterSet: (view, name) =>
        set((state) => ({
          preferences: {
            ...state.preferences,
            [view]: {
              ...state.preferences[view],
              savedFilters: [
                ...state.preferences[view].savedFilters,
                {
                  id: uuidv4(),
                  name,
                  filters: [...state.activeFilters],
                },
              ],
            },
          },
        })),

      loadFilterSet: (view, filterId) => {
        const filterSet = get().preferences[view].savedFilters.find(
          (f) => f.id === filterId
        );
        if (filterSet) {
          set({ activeFilters: [...filterSet.filters], currentPage: 1 });
        }
      },

      deleteFilterSet: (view, filterId) =>
        set((state) => ({
          preferences: {
            ...state.preferences,
            [view]: {
              ...state.preferences[view],
              savedFilters: state.preferences[view].savedFilters.filter(
                (f) => f.id !== filterId
              ),
            },
          },
        })),

      setSelectedRows: (rows) => set({ selectedRows: rows }),

      toggleRowSelection: (rowId) =>
        set((state) => ({
          selectedRows: state.selectedRows.includes(rowId)
            ? state.selectedRows.filter((id) => id !== rowId)
            : [...state.selectedRows, rowId],
        })),

      selectAllRows: (rowIds) => set({ selectedRows: rowIds }),

      clearSelection: () => set({ selectedRows: [] }),

      startEditing: (rowId, field, originalValue) =>
        set((state) => {
          const newEditingCells = new Map(state.editingCells);
          newEditingCells.set(`${rowId}-${field}`, originalValue);
          return { editingCells: newEditingCells };
        }),

      cancelEditing: (rowId, field) =>
        set((state) => {
          const newEditingCells = new Map(state.editingCells);
          newEditingCells.delete(`${rowId}-${field}`);
          return { editingCells: newEditingCells };
        }),

      commitEdit: (rowId, field, newValue) =>
        set((state) => {
          const key = `${rowId}-${field}`;
          const originalValue = state.editingCells.get(key);

          // Only track if value actually changed
          if (originalValue !== String(newValue)) {
            const newPendingChanges = new Map(state.pendingChanges);
            const rowChanges = newPendingChanges.get(rowId) || {};
            rowChanges[field] = newValue;
            newPendingChanges.set(rowId, rowChanges);

            const newEditingCells = new Map(state.editingCells);
            newEditingCells.delete(key);

            return {
              editingCells: newEditingCells,
              pendingChanges: newPendingChanges,
            };
          }

          // Value didn't change, just stop editing
          const newEditingCells = new Map(state.editingCells);
          newEditingCells.delete(key);
          return { editingCells: newEditingCells };
        }),

      discardAllChanges: () =>
        set({
          editingCells: new Map(),
          pendingChanges: new Map(),
        }),

      getPendingChanges: () => get().pendingChanges,

      hasPendingChanges: () => get().pendingChanges.size > 0,

      setPageSize: (view, size) =>
        set((state) => ({
          preferences: {
            ...state.preferences,
            [view]: { ...state.preferences[view], pageSize: size },
          },
          currentPage: 1,
        })),

      getVisibleColumns: (view) => {
        return get()
          .preferences[view].columns.filter((col) => col.visible)
          .sort((a, b) => a.order - b.order);
      },

      buildQueryString: () => {
        const state = get();
        const queryParts: string[] = [];

        // Add search query
        if (state.searchQuery) {
          // Search across common text fields
          const searchFields = ['name', 'number', 'short_description', 'display_name'];
          const searchParts = searchFields.map((field) => `${field}LIKE${state.searchQuery}`);
          queryParts.push(`(${searchParts.join('^OR')})`);
        }

        // Add filters
        for (const filter of state.activeFilters) {
          const operatorMap: Record<string, string> = {
            equals: '=',
            not_equals: '!=',
            contains: 'LIKE',
            starts_with: 'STARTSWITH',
            greater_than: '>',
            less_than: '<',
            is_empty: 'ISEMPTY',
            is_not_empty: 'ISNOTEMPTY',
          };

          const op = operatorMap[filter.operator] || '=';

          if (filter.operator === 'is_empty' || filter.operator === 'is_not_empty') {
            queryParts.push(`${filter.field}${op}`);
          } else if (filter.operator === 'between') {
            const [start, end] = filter.value.split(',');
            queryParts.push(`${filter.field}>=${start}^${filter.field}<=${end}`);
          } else {
            queryParts.push(`${filter.field}${op}${filter.value}`);
          }
        }

        // Add sort
        if (state.sortField) {
          queryParts.push(`ORDERBY${state.sortDirection === 'desc' ? 'DESC' : ''}${state.sortField}`);
        }

        return queryParts.join('^');
      },
    }),
    {
      name: 'servicenow-table-views',
      partialize: (state) => ({
        preferences: state.preferences,
      }),
    }
  )
);
