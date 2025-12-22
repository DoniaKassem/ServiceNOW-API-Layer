import { useState, useCallback, useRef } from 'react';
import type { ColumnConfig } from '../types';

interface DragState {
  isDragging: boolean;
  draggedIndex: number | null;
  targetIndex: number | null;
}

export function useColumnDragDrop(
  columns: ColumnConfig[],
  onReorder: (fromIndex: number, toIndex: number) => void
) {
  const [dragState, setDragState] = useState<DragState>({
    isDragging: false,
    draggedIndex: null,
    targetIndex: null,
  });

  const draggedNodeRef = useRef<HTMLElement | null>(null);

  const handleDragStart = useCallback((e: React.DragEvent, index: number) => {
    // Set drag data
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(index));

    // Store reference to dragged element
    draggedNodeRef.current = e.currentTarget as HTMLElement;

    // Add dragging class after a short delay (for visual feedback)
    requestAnimationFrame(() => {
      if (draggedNodeRef.current) {
        draggedNodeRef.current.classList.add('dragging');
      }
    });

    setDragState({
      isDragging: true,
      draggedIndex: index,
      targetIndex: null,
    });
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, index: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';

    if (dragState.draggedIndex !== null && dragState.draggedIndex !== index) {
      setDragState((prev) => ({
        ...prev,
        targetIndex: index,
      }));
    }
  }, [dragState.draggedIndex]);

  const handleDragEnter = useCallback((e: React.DragEvent, index: number) => {
    e.preventDefault();

    if (dragState.draggedIndex !== null && dragState.draggedIndex !== index) {
      setDragState((prev) => ({
        ...prev,
        targetIndex: index,
      }));
    }
  }, [dragState.draggedIndex]);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    // Only clear target if leaving the column area entirely
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const x = e.clientX;
    const y = e.clientY;

    if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) {
      setDragState((prev) => ({
        ...prev,
        targetIndex: null,
      }));
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent, toIndex: number) => {
    e.preventDefault();

    const fromIndex = parseInt(e.dataTransfer.getData('text/plain'), 10);

    if (!isNaN(fromIndex) && fromIndex !== toIndex) {
      onReorder(fromIndex, toIndex);
    }

    // Clean up
    if (draggedNodeRef.current) {
      draggedNodeRef.current.classList.remove('dragging');
    }
    draggedNodeRef.current = null;

    setDragState({
      isDragging: false,
      draggedIndex: null,
      targetIndex: null,
    });
  }, [onReorder]);

  const handleDragEnd = useCallback(() => {
    // Clean up
    if (draggedNodeRef.current) {
      draggedNodeRef.current.classList.remove('dragging');
    }
    draggedNodeRef.current = null;

    setDragState({
      isDragging: false,
      draggedIndex: null,
      targetIndex: null,
    });
  }, []);

  // Get visual order of columns during drag
  const getReorderedColumns = useCallback((): ColumnConfig[] => {
    if (!dragState.isDragging || dragState.draggedIndex === null || dragState.targetIndex === null) {
      return columns;
    }

    const result = [...columns];
    const [removed] = result.splice(dragState.draggedIndex, 1);
    result.splice(dragState.targetIndex, 0, removed);
    return result;
  }, [columns, dragState]);

  const getColumnDropIndicator = useCallback((index: number): 'left' | 'right' | null => {
    if (!dragState.isDragging || dragState.draggedIndex === null || dragState.targetIndex === null) {
      return null;
    }

    if (index === dragState.targetIndex) {
      return dragState.draggedIndex < dragState.targetIndex ? 'right' : 'left';
    }

    return null;
  }, [dragState]);

  return {
    dragState,
    handleDragStart,
    handleDragOver,
    handleDragEnter,
    handleDragLeave,
    handleDrop,
    handleDragEnd,
    getReorderedColumns,
    getColumnDropIndicator,
  };
}
