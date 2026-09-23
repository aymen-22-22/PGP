import type { Currency, PrinterConnectionType, Role } from './enums';

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  warehouseId: string | null;
  warehouseName: string | null;
  costCenterId: string | null;
  costCenterName: string | null;
  /** The country the user's warehouse sits in — drives prices and local currency. */
  countryId: string | null;
  countryCode: string | null;
  countryCurrency: Currency | null;
  /** Whether this person wants the operational emails. */
  notifyByEmail: boolean;
  /** How this person's browser prints unit labels. */
  printerConnectionType: PrinterConnectionType;
  /** host:port for NETWORK, the agent's URL for AGENT, null for BROWSER. */
  printerAddress: string | null;
  /** The label size to default to, e.g. "58x40". */
  printerLabelSize: string;
  /** The language this person chose; null = the browser decides. */
  language: string | null;
}
