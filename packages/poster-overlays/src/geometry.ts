import type { OverlayTemplateDesign } from '@vynode/contracts';

export interface OverlayRenderGeometry {
  elementId: string;
  layerOrder: number;
  left: number;
  top: number;
  width: number;
  height: number;
  rotation: number;
  clipped: boolean;
}

export const planOverlayGeometry = (
  design: OverlayTemplateDesign,
  posterWidth: number,
  posterHeight: number
): readonly OverlayRenderGeometry[] => {
  if (
    !Number.isSafeInteger(posterWidth) ||
    !Number.isSafeInteger(posterHeight) ||
    posterWidth <= 0 ||
    posterHeight <= 0
  )
    throw new Error('Poster dimensions must be positive whole numbers.');
  const scale = Math.min(
    posterWidth / design.width,
    posterHeight / design.height
  );
  const offsetX = (posterWidth - design.width * scale) / 2;
  const offsetY = (posterHeight - design.height * scale) / 2;
  return [...design.elements]
    .sort(
      (left, right) =>
        left.layerOrder - right.layerOrder || left.id.localeCompare(right.id)
    )
    .map((element) => {
      const intendedWidth = Math.max(1, Math.round(element.width * scale));
      const intendedHeight = Math.max(1, Math.round(element.height * scale));
      const intendedLeft = Math.round(offsetX + element.x * scale);
      const intendedTop = Math.round(offsetY + element.y * scale);
      const left = Math.max(0, intendedLeft);
      const top = Math.max(0, intendedTop);
      const width = Math.max(
        1,
        Math.min(intendedWidth - (left - intendedLeft), posterWidth - left)
      );
      const height = Math.max(
        1,
        Math.min(intendedHeight - (top - intendedTop), posterHeight - top)
      );
      return {
        elementId: element.id,
        layerOrder: element.layerOrder,
        left,
        top,
        width,
        height,
        rotation: element.rotation,
        clipped:
          left !== intendedLeft ||
          top !== intendedTop ||
          width !== intendedWidth ||
          height !== intendedHeight,
      };
    });
};
