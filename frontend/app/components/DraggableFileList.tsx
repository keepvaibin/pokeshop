"use client";

import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  useSortable,
  horizontalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, X } from 'lucide-react';

interface DraggableFileListProps {
  files: File[];
  urls: string[];
  onReorder: (files: File[], urls: string[]) => void;
  onRemove: (index: number) => void;
}

function SortableFileItem({ id, url, onRemove }: { id: number; url: string; onRemove: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };
  return (
    <div ref={setNodeRef} style={style} className="relative group flex-shrink-0">
      <img src={url} alt="" className="w-16 h-16 object-cover rounded-lg border border-gray-200" />
      <button
        type="button"
        {...attributes}
        {...listeners}
        className="absolute -top-1 -left-1 bg-white border border-gray-300 rounded p-0.5 opacity-0 group-hover:opacity-100 transition-opacity cursor-grab active:cursor-grabbing"
      >
        <GripVertical size={12} className="text-gray-500" />
      </button>
      <button
        type="button"
        onClick={onRemove}
        className="absolute -top-1.5 -right-1.5 bg-red-500 text-white rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
      >
        <X size={12} />
      </button>
    </div>
  );
}

export default function DraggableFileList({ files, urls, onReorder, onRemove }: DraggableFileListProps) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  // Use index-based IDs (offset by 1 to avoid id=0 which @dnd-kit treats as falsy)
  const ids = files.map((_, i) => i + 1);

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = ids.indexOf(Number(active.id));
    const newIndex = ids.indexOf(Number(over.id));
    const newFiles = arrayMove([...files], oldIndex, newIndex);
    const newUrls = arrayMove([...urls], oldIndex, newIndex);
    onReorder(newFiles, newUrls);
  };

  if (files.length === 0) return null;

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={ids} strategy={horizontalListSortingStrategy}>
        <div className="flex flex-wrap gap-2">
          {files.map((_, i) => (
            <SortableFileItem key={i} id={i + 1} url={urls[i]} onRemove={() => onRemove(i)} />
          ))}
        </div>
      </SortableContext>
      <p className="text-xs text-gray-500 mt-1">Drag images to reorder</p>
    </DndContext>
  );
}
