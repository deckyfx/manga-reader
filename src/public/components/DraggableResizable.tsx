import React, { useState, useRef, useEffect, type ReactNode } from "react";

/**
 * Resize handle positions
 */
type ResizeHandle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

/**
 * Position and size state
 */
interface BoxState {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface DraggableResizableProps {
  children?: ReactNode;
  initialX?: number;
  initialY?: number;
  initialWidth?: number;
  initialHeight?: number;
  minWidth?: number;
  minHeight?: number;
  onPositionChange?: (x: number, y: number) => void;
  onSizeChange?: (width: number, height: number) => void;
}

/**
 * DraggableResizable Component
 *
 * Custom implementation of draggable and resizable box.
 * Features:
 * - Drag to move
 * - 8 resize handles (corners + edges)
 * - Bounded to parent container
 * - Works with React 19+
 */
export function DraggableResizable({
  children,
  initialX = 50,
  initialY = 50,
  initialWidth = 200,
  initialHeight = 100,
  minWidth = 50,
  minHeight = 50,
  onPositionChange,
  onSizeChange,
}: DraggableResizableProps) {
  const [box, setBox] = useState<BoxState>({
    x: initialX,
    y: initialY,
    width: initialWidth,
    height: initialHeight,
  });
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState<ResizeHandle | null>(null);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const boxRef = useRef<HTMLDivElement>(null);

  /**
   * Handle mouse down on box (start dragging)
   */
  const handleMouseDown = (e: React.MouseEvent) => {
    // Ignore if clicking on resize handle
    if ((e.target as HTMLElement).classList.contains("resize-handle")) {
      return;
    }

    setIsDragging(true);
    setDragStart({
      x: e.clientX - box.x,
      y: e.clientY - box.y,
    });
    e.preventDefault();
  };

  /**
   * Handle mouse down on resize handle
   */
  const handleResizeMouseDown = (handle: ResizeHandle) => (e: React.MouseEvent) => {
    setIsResizing(handle);
    setDragStart({ x: e.clientX, y: e.clientY });
    e.preventDefault();
    e.stopPropagation();
  };

  /**
   * Handle mouse move (dragging or resizing)
   */
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isDragging) {
        const newX = Math.max(0, e.clientX - dragStart.x);
        const newY = Math.max(0, e.clientY - dragStart.y);

        setBox((prev) => {
          const updated = { ...prev, x: newX, y: newY };
          onPositionChange?.(newX, newY);
          return updated;
        });
      } else if (isResizing && boxRef.current) {
        const deltaX = e.clientX - dragStart.x;
        const deltaY = e.clientY - dragStart.y;

        setBox((prev) => {
          let newBox = { ...prev };

          // Handle different resize directions
          switch (isResizing) {
            case "se": // Bottom-right
              newBox.width = Math.max(minWidth, prev.width + deltaX);
              newBox.height = Math.max(minHeight, prev.height + deltaY);
              break;
            case "sw": // Bottom-left
              newBox.width = Math.max(minWidth, prev.width - deltaX);
              newBox.height = Math.max(minHeight, prev.height + deltaY);
              newBox.x = prev.x + (prev.width - newBox.width);
              break;
            case "ne": // Top-right
              newBox.width = Math.max(minWidth, prev.width + deltaX);
              newBox.height = Math.max(minHeight, prev.height - deltaY);
              newBox.y = prev.y + (prev.height - newBox.height);
              break;
            case "nw": // Top-left
              newBox.width = Math.max(minWidth, prev.width - deltaX);
              newBox.height = Math.max(minHeight, prev.height - deltaY);
              newBox.x = prev.x + (prev.width - newBox.width);
              newBox.y = prev.y + (prev.height - newBox.height);
              break;
            case "e": // Right
              newBox.width = Math.max(minWidth, prev.width + deltaX);
              break;
            case "w": // Left
              newBox.width = Math.max(minWidth, prev.width - deltaX);
              newBox.x = prev.x + (prev.width - newBox.width);
              break;
            case "s": // Bottom
              newBox.height = Math.max(minHeight, prev.height + deltaY);
              break;
            case "n": // Top
              newBox.height = Math.max(minHeight, prev.height - deltaY);
              newBox.y = prev.y + (prev.height - newBox.height);
              break;
          }

          onSizeChange?.(newBox.width, newBox.height);
          return newBox;
        });

        setDragStart({ x: e.clientX, y: e.clientY });
      }
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      setIsResizing(null);
    };

    if (isDragging || isResizing) {
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);

      return () => {
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
      };
    }
  }, [isDragging, isResizing, dragStart, minWidth, minHeight]);

  /**
   * Resize handle component
   */
  const ResizeHandle = ({ position }: { position: ResizeHandle }) => {
    const positionStyles: Record<ResizeHandle, string> = {
      nw: "top-0 left-0 cursor-nwse-resize",
      n: "top-0 left-1/2 -translate-x-1/2 cursor-ns-resize",
      ne: "top-0 right-0 cursor-nesw-resize",
      e: "top-1/2 right-0 -translate-y-1/2 cursor-ew-resize",
      se: "bottom-0 right-0 cursor-nwse-resize",
      s: "bottom-0 left-1/2 -translate-x-1/2 cursor-ns-resize",
      sw: "bottom-0 left-0 cursor-nesw-resize",
      w: "top-1/2 left-0 -translate-y-1/2 cursor-ew-resize",
    };

    return (
      <div
        className={`resize-handle absolute w-3 h-3 bg-blue-500 border border-white rounded-sm ${positionStyles[position]}`}
        onMouseDown={handleResizeMouseDown(position)}
      />
    );
  };

  return (
    <div
      ref={boxRef}
      className="absolute select-none"
      style={{
        left: `${box.x}px`,
        top: `${box.y}px`,
        width: `${box.width}px`,
        height: `${box.height}px`,
      }}
      onMouseDown={handleMouseDown}
    >
      {/* Content */}
      <div className="w-full h-full">{children}</div>

      {/* Resize handles */}
      <ResizeHandle position="nw" />
      <ResizeHandle position="n" />
      <ResizeHandle position="ne" />
      <ResizeHandle position="e" />
      <ResizeHandle position="se" />
      <ResizeHandle position="s" />
      <ResizeHandle position="sw" />
      <ResizeHandle position="w" />
    </div>
  );
}
