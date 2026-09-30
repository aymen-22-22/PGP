import { BarcodeFormat, MultiFormatWriter } from '@zxing/library';
import { useMemo } from 'react';

/**
 * The code as a square symbol, drawn as SVG rather than a canvas.
 *
 * SVG prints at the printer's resolution instead of the screen's, which is the
 * difference between a symbol a scanner reads first time and one it has to be
 * coaxed into. The encoder is the one already in the bundle for the camera
 * scanner — adding a barcode library for this would be a second copy of the
 * same table of patterns.
 */
export function CodeSymbol({ value, size = 96 }: { value: string; size?: number }) {
  const path = useMemo(() => {
    const matrix = new MultiFormatWriter().encode(
      value,
      BarcodeFormat.QR_CODE,
      size,
      size,
      new Map(),
    );
    const parts: string[] = [];
    for (let y = 0; y < matrix.getHeight(); y++) {
      for (let x = 0; x < matrix.getWidth(); x++) {
        if (matrix.get(x, y)) parts.push(`M${x} ${y}h1v1h-1z`);
      }
    }
    return { d: parts.join(''), width: matrix.getWidth(), height: matrix.getHeight() };
  }, [value, size]);

  return (
    <svg
      viewBox={`0 0 ${path.width} ${path.height}`}
      width={size}
      height={size}
      shapeRendering="crispEdges"
      aria-label={value}
      className="shrink-0"
    >
      <rect width={path.width} height={path.height} fill="#fff" />
      <path d={path.d} fill="#000" />
    </svg>
  );
}

