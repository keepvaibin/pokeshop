"use client";
/* eslint-disable @next/next/no-img-element */

import { useState } from 'react';
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
import { GripVertical } from 'lucide-react';

interface ImageItem {
  id: number;
  url: string;
  position: number;
}

interface DraggableImageListProps {
  images: ImageItem[];
  onReorder: (orderedIds: number[]) => void;
}

function SortableImage({ image }: { image: ImageItem }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: image.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };
  return (
    <div ref={setNodeRef} style={style} className="relative group flex-shrink-0">
      <img src={image.url} alt="" className="w-16 h-16 object-cover rounded-lg border border-gray-200 dark:border-zinc-700" />
      <button
        type="button"
        {...attributes}
        {...listeners}
        className="absolute -top-1 -left-1 bg-white dark:bg-zinc-800 border border-gray-300 dark:border-zinc-600 rounded p-0.5 opacity-0 group-hover:opacity-100 transition-opacity cursor-grab active:cursor-grabbing"
      >
        <GripVertical size={12} className="text-gray-500" />
      </button>
    </div>
  );
}

export default function DraggableImageList({ images, onReorder }: DraggableImageListProps) {
  const [items, setItems] = useState(images);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = items.findIndex((i) => i.id === active.id);
    const newIndex = items.findIndex((i) => i.id === over.id);
    const reordered = arrayMove(items, oldIndex, newIndex);
    setItems(reordered);
    onReorder(reordered.map((i) => i.id));
  };

  if (items.length === 0) return null;

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={items.map((i) => i.id)} strategy={horizontalListSortingStrategy}>
        <div className="flex flex-wrap gap-2">
          {items.map((img) => (
            <SortableImage key={img.id} image={img} />
          ))}
        </div>
      </SortableContext>
      <p className="text-xs text-gray-500 mt-1">Drag images to reorder</p>
    </DndContext>
  );
}
