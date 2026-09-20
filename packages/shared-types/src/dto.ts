import type { Currency, Role } from './enums';

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
}
