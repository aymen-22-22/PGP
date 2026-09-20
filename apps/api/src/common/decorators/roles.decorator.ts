import { SetMetadata } from '@nestjs/common';
import { Role } from '@prisma/client';

export const ROLES_KEY = 'roles';

export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);

/** Shorthand for endpoints only an administrator may call. */
export const AdminOnly = () => Roles(Role.ADMIN);
