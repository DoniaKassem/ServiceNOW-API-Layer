import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import {
  ChevronUp,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Settings,
  Search,
  Filter,
  Download,
  Upload,
  Plus,
  Trash2,
  Edit3,
  RefreshCw,
  CheckSquare,
  Square,
  Loader2,
  AlertCircle,
  Save,
  X,
  GripVertical,
} from 'lucide-react';
import { clsx } from 'clsx';
import { format } from 'date-fns';
import { useTableViewStore } from '../../stores/tableViewStore';
import { useColumnDragDrop } from '../../hooks/useColumnDragDrop';
import type { TableViewType, ColumnConfig, FilterCondition } from '../../types';

interface DataTableProps {
  viewType: TableViewType;
  data: Record<string, unknown>[];
  totalCount: number;
  isLoading: boolean;
  error?: string;
  onRefresh: () => void;
  onRowClick?: (row: Record<string, unknown>) => void;
  onCreateNew?: () => void;
  onBulkDelete?: (sysIds: string[]) => void;
  onBulkEdit?: (sysIds: string[]) => void;
  onSaveChanges?: (changes: Map<string, Record<string, unknown>>) => Promise<void>;
  onExport?: (format: 'csv' | 'xlsx' | 'json') => void;
  onImport?: () => void;
}

export function DataTable({
  viewType,
  data,
  totalCount,
  isLoading,
  error,
  onRefresh,
  onRowClick,
  onCreateNew,
  onBulkDelete,
  onBulkEdit,
  onSaveChanges,
  onExport,
  onImport,
}: DataTableProps) {
  const {
    preferences,
    currentPage,
    searchQuery,
    activeFilters,
    sortField,
    sortDirection,
    selectedRows,
    pendingChanges,
    setCurrentPage,
    setSearchQuery,
    setSortField,
    toggleSortDirection,
    toggleRowSelection,
    selectAllRows,
    clearSelection,
    discardAllChanges,
    hasPendingChanges,
    getVisibleColumns,
    startEditing,
    commitEdit,
    cancelEditing,
    reorderColumns,
  } = useTableViewStore();

  const [showColumnSelector, setShowColumnSelector] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [localSearchQuery, setLocalSearchQuery] = useState(searchQuery);
  const [editingCell, setEditingCell] = useState<{ rowId: string; field: string } | null>(null);
  const [editValue, setEditValue] = useState<string>('');
  const [isSaving, setIsSaving] = useState(false);
  const [isScrolled, setIsScrolled] = useState(false);
  const tableContainerRef = useRef<HTMLDivElement>(null);

  const visibleColumns = useMemo(() => getVisibleColumns(viewType), [viewType, preferences]);
  const pageSize = preferences[viewType].pageSize;
  const totalPages = Math.ceil(totalCount / pageSize);

  // Column drag-and-drop
  const handleColumnReorder = useCallback((fromIndex: number, toIndex: number) => {
    // Account for checkbox column offset
    reorderColumns(viewType, fromIndex, toIndex);
  }, [viewType, reorderColumns]);

  const {
    dragState,
    handleDragStart,
    handleDragOver,
    handleDragEnter,
    handleDragLeave,
    handleDrop,
    handleDragEnd,
    getColumnDropIndicator,
  } = useColumnDragDrop(visibleColumns, handleColumnReorder);

  // Track scroll for sticky header shadow
  useEffect(() => {
    const container = tableContainerRef.current;
    if (!container) return;

    const handleScroll = () => {
      setIsScrolled(container.scrollTop > 0);
    };

    container.addEventListener('scroll', handleScroll);
    return () => container.removeEventListener('scroll', handleScroll);
  }, []);

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearchQuery(localSearchQuery);
    }, 300);
    return () => clearTimeout(timer);
  }, [localSearchQuery, setSearchQuery]);

  const handleSort = useCallback((field: string) => {
    if (sortField === field) {
      toggleSortDirection();
    } else {
      setSortField(field);
    }
  }, [sortField, setSortField, toggleSortDirection]);

  const handleSelectAll = useCallback(() => {
    if (selectedRows.length === data.length) {
      clearSelection();
    } else {
      selectAllRows(data.map((row) => row.sys_id as string));
    }
  }, [selectedRows, data, selectAllRows, clearSelection]);

  const handleCellDoubleClick = useCallback((rowId: string, field: string, value: unknown) => {
    setEditingCell({ rowId, field });
    setEditValue(String(value ?? ''));
    startEditing(rowId, field, String(value ?? ''));
  }, [startEditing]);

  const handleCellEditSave = useCallback(() => {
    if (editingCell) {
      commitEdit(editingCell.rowId, editingCell.field, editValue);
      setEditingCell(null);
    }
  }, [editingCell, editValue, commitEdit]);

  const handleCellEditCancel = useCallback(() => {
    if (editingCell) {
      cancelEditing(editingCell.rowId, editingCell.field);
      setEditingCell(null);
    }
  }, [editingCell, cancelEditing]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleCellEditSave();
    } else if (e.key === 'Escape') {
      handleCellEditCancel();
    }
  }, [handleCellEditSave, handleCellEditCancel]);

  const handleSaveAllChanges = useCallback(async () => {
    if (onSaveChanges && hasPendingChanges()) {
      setIsSaving(true);
      try {
        await onSaveChanges(pendingChanges);
        discardAllChanges();
      } finally {
        setIsSaving(false);
      }
    }
  }, [onSaveChanges, hasPendingChanges, pendingChanges, discardAllChanges]);

  const formatCellValue = useCallback((value: unknown, column: ColumnConfig): string => {
    if (value === null || value === undefined) return '-';

    // Handle reference fields (display value)
    if (typeof value === 'object' && value !== null) {
      const refValue = value as { display_value?: string; value?: string };
      return refValue.display_value || refValue.value || '-';
    }

    // Handle dates
    if (column.type === 'date' && typeof value === 'string') {
      try {
        return format(new Date(value), 'MMM d, yyyy');
      } catch {
        return value;
      }
    }

    // Handle currency
    if (column.type === 'currency' && typeof value === 'string') {
      const num = parseFloat(value);
      if (!isNaN(num)) {
        return new Intl.NumberFormat('en-US', {
          style: 'currency',
          currency: 'USD',
        }).format(num);
      }
    }

    // Handle booleans
    if (column.type === 'boolean') {
      return value === 'true' || value === true ? 'Yes' : 'No';
    }

    return String(value);
  }, []);

  const getCellClassName = useCallback((rowId: string, field: string): string => {
    const hasChange = pendingChanges.get(rowId)?.[field] !== undefined;
    return clsx(
      'px-4 py-3 text-sm',
      hasChange && 'bg-yellow-50'
    );
  }, [pendingChanges]);

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center justify-between p-4 border-b border-gray-200 bg-white">
        <div className="flex items-center gap-3">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              value={localSearchQuery}
              onChange={(e) => setLocalSearchQuery(e.target.value)}
              placeholder="Search..."
              className="pl-10 pr-4 py-2 w-64 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>

          {/* Filters Toggle */}
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={clsx(
              'flex items-center gap-2 px-3 py-2 text-sm rounded-lg border',
              showFilters || activeFilters.length > 0
                ? 'bg-blue-50 border-blue-200 text-blue-700'
                : 'border-gray-300 text-gray-700 hover:bg-gray-50'
            )}
          >
            <Filter className="w-4 h-4" />
            Filters
            {activeFilters.length > 0 && (
              <span className="px-1.5 py-0.5 text-xs bg-blue-100 text-blue-700 rounded-full">
                {activeFilters.length}
              </span>
            )}
          </button>

          {/* Column Selector */}
          <button
            onClick={() => setShowColumnSelector(!showColumnSelector)}
            className={clsx(
              'flex items-center gap-2 px-3 py-2 text-sm rounded-lg border',
              showColumnSelector
                ? 'bg-blue-50 border-blue-200 text-blue-700'
                : 'border-gray-300 text-gray-700 hover:bg-gray-50'
            )}
          >
            <Settings className="w-4 h-4" />
            Columns
          </button>
        </div>

        <div className="flex items-center gap-2">
          {/* Pending Changes Actions */}
          {hasPendingChanges() && (
            <>
              <button
                onClick={discardAllChanges}
                className="flex items-center gap-2 px-3 py-2 text-sm text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg"
              >
                <X className="w-4 h-4" />
                Discard
              </button>
              <button
                onClick={handleSaveAllChanges}
                disabled={isSaving}
                className="flex items-center gap-2 px-3 py-2 text-sm text-white bg-green-600 hover:bg-green-700 rounded-lg disabled:opacity-50"
              >
                {isSaving ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Save className="w-4 h-4" />
                )}
                Save Changes
              </button>
            </>
          )}

          {/* Bulk Actions */}
          {selectedRows.length > 0 && (
            <>
              <span className="text-sm text-gray-500">
                {selectedRows.length} selected
              </span>
              {onBulkEdit && (
                <button
                  onClick={() => onBulkEdit(selectedRows)}
                  className="flex items-center gap-2 px-3 py-2 text-sm text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg"
                >
                  <Edit3 className="w-4 h-4" />
                  Edit
                </button>
              )}
              {onBulkDelete && (
                <button
                  onClick={() => onBulkDelete(selectedRows)}
                  className="flex items-center gap-2 px-3 py-2 text-sm text-white bg-red-600 hover:bg-red-700 rounded-lg"
                >
                  <Trash2 className="w-4 h-4" />
                  Delete
                </button>
              )}
            </>
          )}

          {/* Export */}
          <div className="relative">
            <button
              onClick={() => setShowExportMenu(!showExportMenu)}
              className="flex items-center gap-2 px-3 py-2 text-sm text-gray-700 border border-gray-300 hover:bg-gray-50 rounded-lg"
            >
              <Download className="w-4 h-4" />
              Export
            </button>
            {showExportMenu && onExport && (
              <div className="absolute right-0 mt-1 w-40 bg-white border border-gray-200 rounded-lg shadow-lg z-10">
                <button
                  onClick={() => {
                    onExport('xlsx');
                    setShowExportMenu(false);
                  }}
                  className="w-full px-4 py-2 text-sm text-left hover:bg-gray-50"
                >
                  Export to Excel
                </button>
                <button
                  onClick={() => {
                    onExport('csv');
                    setShowExportMenu(false);
                  }}
                  className="w-full px-4 py-2 text-sm text-left hover:bg-gray-50"
                >
                  Export to CSV
                </button>
                <button
                  onClick={() => {
                    onExport('json');
                    setShowExportMenu(false);
                  }}
                  className="w-full px-4 py-2 text-sm text-left hover:bg-gray-50"
                >
                  Export to JSON
                </button>
              </div>
            )}
          </div>

          {/* Refresh */}
          <button
            onClick={onRefresh}
            disabled={isLoading}
            className="p-2 text-gray-700 border border-gray-300 hover:bg-gray-50 rounded-lg disabled:opacity-50"
          >
            <RefreshCw className={clsx('w-4 h-4', isLoading && 'animate-spin')} />
          </button>

          {/* Import */}
          {onImport && (
            <button
              onClick={onImport}
              className="flex items-center gap-2 px-4 py-2 text-sm text-gray-700 border border-gray-300 hover:bg-gray-50 rounded-lg"
            >
              <Upload className="w-4 h-4" />
              Import
            </button>
          )}

          {/* Create New */}
          {onCreateNew && (
            <button
              onClick={onCreateNew}
              className="flex items-center gap-2 px-4 py-2 text-sm text-white bg-blue-600 hover:bg-blue-700 rounded-lg"
            >
              <Plus className="w-4 h-4" />
              New Record
            </button>
          )}
        </div>
      </div>

      {/* Filter Panel */}
      {showFilters && (
        <FilterPanel
          viewType={viewType}
          columns={visibleColumns}
          activeFilters={activeFilters}
        />
      )}

      {/* Column Selector Panel */}
      {showColumnSelector && (
        <ColumnSelectorPanel
          viewType={viewType}
          onClose={() => setShowColumnSelector(false)}
        />
      )}

      {/* Table */}
      <div ref={tableContainerRef} className="flex-1 overflow-auto">
        {error ? (
          <div className="flex flex-col items-center justify-center h-full text-red-500">
            <AlertCircle className="w-12 h-12 mb-4" />
            <p className="text-lg font-medium">Error loading data</p>
            <p className="text-sm">{error}</p>
            <button
              onClick={onRefresh}
              className="mt-4 px-4 py-2 text-sm text-white bg-red-600 hover:bg-red-700 rounded-lg"
            >
              Retry
            </button>
          </div>
        ) : (
          <table className="w-full">
            <thead
              className={clsx(
                'bg-gray-50 sticky top-0 z-10 transition-shadow duration-200',
                isScrolled && 'shadow-md'
              )}
            >
              <tr>
                {/* Checkbox Column */}
                <th className="w-12 px-4 py-3 border-b border-gray-200 bg-gray-50">
                  <button onClick={handleSelectAll} className="text-gray-400 hover:text-gray-600">
                    {selectedRows.length === data.length && data.length > 0 ? (
                      <CheckSquare className="w-4 h-4" />
                    ) : (
                      <Square className="w-4 h-4" />
                    )}
                  </button>
                </th>

                {/* Data Columns - Draggable */}
                {visibleColumns.map((column, index) => {
                  const dropIndicator = getColumnDropIndicator(index);
                  const isDragging = dragState.isDragging && dragState.draggedIndex === index;

                  return (
                    <th
                      key={column.field}
                      draggable
                      onDragStart={(e) => handleDragStart(e, index)}
                      onDragOver={(e) => handleDragOver(e, index)}
                      onDragEnter={(e) => handleDragEnter(e, index)}
                      onDragLeave={handleDragLeave}
                      onDrop={(e) => handleDrop(e, index)}
                      onDragEnd={handleDragEnd}
                      className={clsx(
                        'px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider border-b border-gray-200 bg-gray-50 select-none relative',
                        isDragging && 'opacity-50',
                        dropIndicator === 'left' && 'before:absolute before:left-0 before:top-0 before:bottom-0 before:w-0.5 before:bg-blue-500',
                        dropIndicator === 'right' && 'after:absolute after:right-0 after:top-0 after:bottom-0 after:w-0.5 after:bg-blue-500'
                      )}
                    >
                      <div className="flex items-center gap-1 group">
                        <GripVertical className="w-3 h-3 text-gray-300 opacity-0 group-hover:opacity-100 transition-opacity cursor-grab flex-shrink-0" />
                        <button
                          onClick={() => handleSort(column.field)}
                          className="flex items-center gap-1 hover:text-gray-700"
                        >
                          {column.label}
                          {sortField === column.field && (
                            sortDirection === 'asc' ? (
                              <ChevronUp className="w-4 h-4" />
                            ) : (
                              <ChevronDown className="w-4 h-4" />
                            )
                          )}
                        </button>
                      </div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {isLoading ? (
                <tr>
                  <td colSpan={visibleColumns.length + 1} className="py-12">
                    <div className="flex items-center justify-center">
                      <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
                    </div>
                  </td>
                </tr>
              ) : data.length === 0 ? (
                <tr>
                  <td colSpan={visibleColumns.length + 1} className="py-12">
                    <div className="text-center text-gray-500">
                      <p className="text-lg">No records found</p>
                      <p className="text-sm">Try adjusting your search or filters</p>
                    </div>
                  </td>
                </tr>
              ) : (
                data.map((row) => {
                  const rowId = row.sys_id as string;
                  const isSelected = selectedRows.includes(rowId);

                  return (
                    <tr
                      key={rowId}
                      className={clsx(
                        'hover:bg-gray-50 cursor-pointer',
                        isSelected && 'bg-blue-50'
                      )}
                      onClick={() => onRowClick?.(row)}
                    >
                      {/* Checkbox */}
                      <td
                        className="px-4 py-3"
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleRowSelection(rowId);
                        }}
                      >
                        {isSelected ? (
                          <CheckSquare className="w-4 h-4 text-blue-600" />
                        ) : (
                          <Square className="w-4 h-4 text-gray-400" />
                        )}
                      </td>

                      {/* Data Cells */}
                      {visibleColumns.map((column) => {
                        const isEditing = editingCell?.rowId === rowId && editingCell?.field === column.field;
                        const cellValue = row[column.field];

                        return (
                          <td
                            key={column.field}
                            className={getCellClassName(rowId, column.field)}
                            onDoubleClick={(e) => {
                              e.stopPropagation();
                              handleCellDoubleClick(rowId, column.field, cellValue);
                            }}
                          >
                            {isEditing ? (
                              <input
                                type="text"
                                value={editValue}
                                onChange={(e) => setEditValue(e.target.value)}
                                onKeyDown={handleKeyDown}
                                onBlur={handleCellEditSave}
                                className="w-full px-2 py-1 border border-blue-500 rounded focus:ring-2 focus:ring-blue-500"
                                autoFocus
                                onClick={(e) => e.stopPropagation()}
                              />
                            ) : (
                              <span className="truncate block max-w-xs">
                                {formatCellValue(cellValue, column)}
                              </span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between p-4 border-t border-gray-200 bg-white">
        <div className="text-sm text-gray-500">
          Showing {((currentPage - 1) * pageSize) + 1} to {Math.min(currentPage * pageSize, totalCount)} of {totalCount} records
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setCurrentPage(currentPage - 1)}
            disabled={currentPage === 1}
            className="p-2 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>

          <span className="px-4 py-2 text-sm text-gray-700">
            Page {currentPage} of {totalPages || 1}
          </span>

          <button
            onClick={() => setCurrentPage(currentPage + 1)}
            disabled={currentPage >= totalPages}
            className="p-2 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

// Filter Panel Component
function FilterPanel({
  viewType,
  columns,
  activeFilters,
}: {
  viewType: TableViewType;
  columns: ColumnConfig[];
  activeFilters: FilterCondition[];
}) {
  const { addFilter, updateFilter, removeFilter, clearFilters, saveFilterSet, preferences, loadFilterSet } = useTableViewStore();
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [filterName, setFilterName] = useState('');

  const savedFilters = preferences[viewType].savedFilters;

  return (
    <div className="p-4 border-b border-gray-200 bg-gray-50 space-y-3">
      {/* Active Filters */}
      <div className="flex flex-wrap gap-2">
        {activeFilters.map((filter) => (
          <div
            key={filter.id}
            className="flex items-center gap-2 px-3 py-1.5 bg-white border border-gray-200 rounded-lg text-sm"
          >
            <select
              value={filter.field}
              onChange={(e) => updateFilter(filter.id, { field: e.target.value })}
              className="border-0 bg-transparent text-sm focus:ring-0"
            >
              {columns.map((col) => (
                <option key={col.field} value={col.field}>{col.label}</option>
              ))}
            </select>

            <select
              value={filter.operator}
              onChange={(e) => updateFilter(filter.id, { operator: e.target.value as any })}
              className="border-0 bg-transparent text-sm focus:ring-0"
            >
              <option value="equals">equals</option>
              <option value="not_equals">not equals</option>
              <option value="contains">contains</option>
              <option value="starts_with">starts with</option>
              <option value="greater_than">greater than</option>
              <option value="less_than">less than</option>
              <option value="is_empty">is empty</option>
              <option value="is_not_empty">is not empty</option>
            </select>

            {!['is_empty', 'is_not_empty'].includes(filter.operator) && (
              <input
                type="text"
                value={filter.value}
                onChange={(e) => updateFilter(filter.id, { value: e.target.value })}
                className="w-32 px-2 py-0.5 border border-gray-200 rounded text-sm"
                placeholder="Value"
              />
            )}

            <button
              onClick={() => removeFilter(filter.id)}
              className="text-gray-400 hover:text-red-500"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        ))}

        {/* Add Filter Button */}
        <button
          onClick={() => addFilter({
            field: columns[0]?.field || 'name',
            operator: 'contains',
            value: '',
          })}
          className="flex items-center gap-1 px-3 py-1.5 text-sm text-blue-600 hover:bg-blue-50 rounded-lg"
        >
          <Plus className="w-4 h-4" />
          Add Filter
        </button>
      </div>

      {/* Filter Actions */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {savedFilters.length > 0 && (
            <select
              onChange={(e) => {
                if (e.target.value) {
                  loadFilterSet(viewType, e.target.value);
                }
              }}
              className="text-sm border border-gray-300 rounded-lg px-2 py-1"
              defaultValue=""
            >
              <option value="">Load saved filter...</option>
              {savedFilters.map((sf) => (
                <option key={sf.id} value={sf.id}>{sf.name}</option>
              ))}
            </select>
          )}
        </div>

        <div className="flex items-center gap-2">
          {activeFilters.length > 0 && (
            <>
              <button
                onClick={() => setShowSaveDialog(true)}
                className="text-sm text-gray-600 hover:text-gray-800"
              >
                Save Filter
              </button>
              <button
                onClick={clearFilters}
                className="text-sm text-red-600 hover:text-red-700"
              >
                Clear All
              </button>
            </>
          )}
        </div>
      </div>

      {/* Save Filter Dialog */}
      {showSaveDialog && (
        <div className="flex items-center gap-2 mt-2">
          <input
            type="text"
            value={filterName}
            onChange={(e) => setFilterName(e.target.value)}
            placeholder="Filter name"
            className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm"
          />
          <button
            onClick={() => {
              if (filterName) {
                saveFilterSet(viewType, filterName);
                setFilterName('');
                setShowSaveDialog(false);
              }
            }}
            className="px-3 py-1.5 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700"
          >
            Save
          </button>
          <button
            onClick={() => setShowSaveDialog(false)}
            className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-800"
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}

// Column Selector Panel
function ColumnSelectorPanel({
  viewType,
  onClose,
}: {
  viewType: TableViewType;
  onClose: () => void;
}) {
  const { preferences, toggleColumnVisibility, resetColumnsToDefault } = useTableViewStore();
  const columns = preferences[viewType].columns;

  return (
    <div className="absolute right-4 top-20 w-64 bg-white border border-gray-200 rounded-lg shadow-lg z-20">
      <div className="flex items-center justify-between p-3 border-b border-gray-200">
        <span className="font-medium text-sm">Visible Columns</span>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="max-h-64 overflow-y-auto p-2">
        {columns.map((column) => (
          <label
            key={column.field}
            className="flex items-center gap-2 px-2 py-1.5 hover:bg-gray-50 rounded cursor-pointer"
          >
            <input
              type="checkbox"
              checked={column.visible}
              onChange={() => toggleColumnVisibility(viewType, column.field)}
              className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            <span className="text-sm text-gray-700">{column.label}</span>
          </label>
        ))}
      </div>

      <div className="p-3 border-t border-gray-200">
        <button
          onClick={() => resetColumnsToDefault(viewType)}
          className="w-full px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 rounded-lg"
        >
          Reset to Default
        </button>
      </div>
    </div>
  );
}
