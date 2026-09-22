/** Common thermal roll sizes, in millimetres — width × height of one label. */
export const LABEL_SIZES = [
  { id: '40x30', width: 40, height: 30 },
  { id: '50x30', width: 50, height: 30 },
  { id: '58x40', width: 58, height: 40 },
  { id: '60x40', width: 60, height: 40 },
  { id: '80x40', width: 80, height: 40 },
] as const;

export type LabelSizeId = (typeof LABEL_SIZES)[number]['id'];

export function isLabelSizeId(value: string): value is LabelSizeId {
  return LABEL_SIZES.some((s) => s.id === value);
}
