import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';

export interface PosterLayerGeometry {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
}

type ResizeDirection = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw';
const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(Math.max(value, minimum), maximum);

export const InteractivePosterLayer = <T extends PosterLayerGeometry>({
  layer, canvasWidth, canvasHeight, selected, snap, className = '',
  onSelect, onPreview, onCommit, children,
}: {
  layer: T;
  canvasWidth: number;
  canvasHeight: number;
  selected: boolean;
  snap: boolean;
  className?: string;
  onSelect(): void;
  onPreview?(geometry: Pick<T, 'x' | 'y' | 'width' | 'height'>): void;
  onCommit(geometry: Pick<T, 'x' | 'y' | 'width' | 'height'>): void;
  children: ReactNode;
}) => {
  const visualLayer = layer as T & {
    type?: string;
    properties?: Record<string, unknown>;
  };
  const properties = visualLayer.properties ?? {};
  const isTextual =
    visualLayer.type === 'text' || visualLayer.type === 'variable';
  const isTile = visualLayer.type === 'tile';
  const canvasUnit = (value: number) =>
    `${(value / canvasWidth) * 100}cqi`;
  const topLeft = Number(
    properties.borderRadiusTopLeft ?? properties.borderRadius ?? 0
  );
  const borderRadius =
    properties.lockCorners === true
      ? canvasUnit(topLeft)
      : [
          topLeft,
          Number(properties.borderRadiusTopRight ?? 0),
          Number(properties.borderRadiusBottomRight ?? 0),
          Number(properties.borderRadiusBottomLeft ?? 0),
        ]
          .map(canvasUnit)
          .join(' ');
  const contentStyle: React.CSSProperties =
    isTextual || isTile
      ? {
          backgroundColor: `color-mix(in srgb, ${String(
            properties.fillColor ?? '#000000'
          )} ${Number(properties.fillOpacity ?? (isTile ? 70 : 0))}%, transparent)`,
          borderColor: String(properties.borderColor ?? 'transparent'),
          borderStyle: 'solid',
          borderWidth: canvasUnit(Number(properties.borderWidth ?? 0)),
          borderRadius,
          ...(isTextual
            ? {
                '--layer-text-color': String(properties.color ?? '#ffffff'),
                '--layer-text-opacity': Number(properties.opacity ?? 100) / 100,
                fontFamily: String(properties.fontFamily ?? 'Inter'),
                fontSize: canvasUnit(Number(properties.fontSize ?? 60)),
                fontWeight: String(
                  properties.fontWeight ?? 'normal'
                ) as React.CSSProperties['fontWeight'],
                fontStyle: String(
                  properties.fontStyle ?? 'normal'
                ) as React.CSSProperties['fontStyle'],
                textAlign: String(
                  properties.textAlign ?? 'left'
                ) as React.CSSProperties['textAlign'],
              } as React.CSSProperties
            : {}),
        }
      : {};
  const [draft, setDraft] = useState(layer);
  const draftRef = useRef(layer);
  const operation = useRef<{
    pointerId: number; startX: number; startY: number; origin: T;
    direction?: ResizeDirection; target: HTMLElement;
  } | undefined>(undefined);
  useEffect(() => {
    if (!operation.current) {
      draftRef.current = layer;
      setDraft(layer);
    }
  }, [layer]);
  const normalize = (value: number) =>
    snap ? Math.round(value / 10) * 10 : Math.round(value);
  const begin = (event: ReactPointerEvent<HTMLElement>, direction?: ResizeDirection) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    onSelect();
    const target = event.currentTarget;
    target.setPointerCapture?.(event.pointerId);
    operation.current = {
      pointerId: event.pointerId, startX: event.clientX, startY: event.clientY,
      origin: draftRef.current, direction, target,
    };
  };
  const move = (event: ReactPointerEvent<HTMLElement>) => {
    const current = operation.current;
    if (!current || current.pointerId !== event.pointerId) return;
    const canvas = event.currentTarget.closest('.poster-interaction-canvas');
    if (!(canvas instanceof HTMLElement)) return;
    const bounds = canvas.getBoundingClientRect();
    const dx = ((event.clientX - current.startX) / bounds.width) * canvasWidth;
    const dy = ((event.clientY - current.startY) / bounds.height) * canvasHeight;
    const next = { ...current.origin };
    if (!current.direction) {
      next.x = clamp(
        normalize(current.origin.x + dx),
        -current.origin.width + 20,
        canvasWidth - 20
      );
      next.y = clamp(
        normalize(current.origin.y + dy),
        -current.origin.height + 20,
        canvasHeight - 20
      );
    } else {
      const minimum = 20;
      if (current.direction.includes('e'))
        next.width = clamp(normalize(current.origin.width + dx), minimum, canvasWidth - current.origin.x);
      if (current.direction.includes('s'))
        next.height = clamp(normalize(current.origin.height + dy), minimum, canvasHeight - current.origin.y);
      if (current.direction.includes('w')) {
        const right = current.origin.x + current.origin.width;
        next.x = clamp(
          normalize(current.origin.x + dx),
          -current.origin.width + minimum,
          right - minimum
        );
        next.width = right - next.x;
      }
      if (current.direction.includes('n')) {
        const bottom = current.origin.y + current.origin.height;
        next.y = clamp(
          normalize(current.origin.y + dy),
          -current.origin.height + minimum,
          bottom - minimum
        );
        next.height = bottom - next.y;
      }
    }
    draftRef.current = next;
    setDraft(next);
    onPreview?.({ x: next.x, y: next.y, width: next.width, height: next.height });
  };
  const finish = (event: ReactPointerEvent<HTMLElement>) => {
    const current = operation.current;
    if (!current || current.pointerId !== event.pointerId) return;
    operation.current = undefined;
    if (current.target.hasPointerCapture?.(event.pointerId))
      current.target.releasePointerCapture(event.pointerId);
    const next = draftRef.current;
    if (next.x !== layer.x || next.y !== layer.y || next.width !== layer.width || next.height !== layer.height)
      onCommit({ x: next.x, y: next.y, width: next.width, height: next.height });
  };
  return (
    <div
      className={`interactive-poster-layer ${className} ${selected ? 'selected' : ''}`}
      style={{
        left: `${(draft.x / canvasWidth) * 100}%`,
        top: `${(draft.y / canvasHeight) * 100}%`,
        width: `${(draft.width / canvasWidth) * 100}%`,
        height: `${(draft.height / canvasHeight) * 100}%`,
        transform: `rotate(${draft.rotation}deg)`,
      }}
      role="button" tabIndex={0}
      aria-label={`Poster layer. Drag to move${selected ? '; resize handles available' : ''}.`}
      onPointerDown={(event) => begin(event)} onPointerMove={move}
      onPointerUp={finish} onPointerCancel={finish}
      onClick={(event) => { event.stopPropagation(); onSelect(); }}
      onKeyDown={(event) => {
        if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
        event.preventDefault();
        const increment = event.shiftKey ? 10 : 1;
        onCommit({
          x: clamp(layer.x + (event.key === 'ArrowLeft' ? -increment : event.key === 'ArrowRight' ? increment : 0), 0, canvasWidth - layer.width),
          y: clamp(layer.y + (event.key === 'ArrowUp' ? -increment : event.key === 'ArrowDown' ? increment : 0), 0, canvasHeight - layer.height),
          width: layer.width, height: layer.height,
        });
      }}
    >
      <div className="interactive-poster-layer-content" style={contentStyle}>
        {children}
      </div>
      {selected && (['n','ne','e','se','s','sw','w','nw'] as const).map((direction) => (
        <span className={`poster-resize-handle ${direction}`} data-direction={direction}
          aria-label={`Resize layer ${direction}`} key={direction}
          onPointerDown={(event) => begin(event, direction)} onPointerMove={move}
          onPointerUp={finish} onPointerCancel={finish} />
      ))}
    </div>
  );
};
