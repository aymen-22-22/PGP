import { Role } from '@prisma/client';

/** The authenticated principal attached to every request by JwtStrategy. */
export interface RequestUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  warehouseId: string | null;
  costCenterId: string | null;
}

export interface JwtPayload {
  sub: string;
  email: string;
  role: Role;
  wid: string | null;
  tv: number;
}
