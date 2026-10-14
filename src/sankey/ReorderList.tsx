import { useRef, useState, type DragEvent, type ReactNode } from "react";

type ReorderListProps<T extends { id: string }> = {
  items: T[];
  // Called once, on drop, with the full id order after the move (only if it changed).
  onReorder: (orderedIds: string[]) => void;
  // Renders one row; `grip` is the drag handle to place somewhere inside it.
  renderItem: (item: T, grip: ReactNode) => ReactNode;
  className?: string;
};

function GripIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="currentColor">
      <circle cx="9" cy="5" r="1.6" />
      <circle cx="15" cy="5" r="1.6" />
      <circle cx="9" cy="12" r="1.6" />
      <circle cx="15" cy="12" r="1.6" />
      <circle cx="9" cy="19" r="1.6" />
      <circle cx="15" cy="19" r="1.6" />
    </svg>
  );
}

// A vertical list whose rows reorder by dragging their grip. Rows are only draggable while the
// grip is pressed, so text inside a row (inputs) stays selectable. The list previews the new
// order live while dragging and reports it once on drop. Lists nest: a row's own handlers stop
// propagation so dragging a child never reorders its parent.
function ReorderList<T extends { id: string }>({ items, onReorder, renderItem, className }: ReorderListProps<T>) {
  const [armedId, setArmedId] = useState<string | null>(null);
  const [preview, setPreview] = useState<string[] | null>(null);
  const draggingId = useRef<string | null>(null);

  const shown = preview
    ? preview.map((id) => items.find((item) => item.id === id)).filter((item): item is T => Boolean(item))
    : items;

  const reset = () => {
    draggingId.current = null;
    setArmedId(null);
    setPreview(null);
  };

  const handleDragStart = (event: DragEvent, id: string) => {
    event.stopPropagation();
    draggingId.current = id;
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", id);
  };

  const handleDragOver = (event: DragEvent, overId: string) => {
    const dragged = draggingId.current;
    if (!dragged) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (dragged === overId) {
      return;
    }
    const current = shown.map((item) => item.id);
    const from = current.indexOf(dragged);
    const to = current.indexOf(overId);
    if (from < 0 || to < 0) {
      return;
    }
    const next = [...current];
    next.splice(from, 1);
    next.splice(to, 0, dragged);
    setPreview(next);
  };

  const handleDragEnd = (event: DragEvent) => {
    event.stopPropagation();
    const original = items.map((item) => item.id);
    if (preview && preview.some((id, index) => id !== original[index])) {
      onReorder(preview);
    }
    reset();
  };

  return (
    <div className={className}>
      {shown.map((item) => (
        <div
          key={item.id}
          className={`sankey-reorder__item ${draggingId.current === item.id ? "sankey-reorder__item--dragging" : ""}`}
          draggable={armedId === item.id}
          onDragStart={(event) => handleDragStart(event, item.id)}
          onDragOver={(event) => handleDragOver(event, item.id)}
          onDrop={(event) => event.preventDefault()}
          onDragEnd={handleDragEnd}
        >
          {renderItem(
            item,
            <button
              type="button"
              className="sankey-grip"
              aria-label="Drag to reorder"
              title="Drag to reorder"
              onMouseDown={() => setArmedId(item.id)}
              onMouseUp={() => setArmedId(null)}
            >
              <GripIcon />
            </button>,
          )}
        </div>
      ))}
    </div>
  );
}

export default ReorderList;
