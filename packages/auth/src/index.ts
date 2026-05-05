// Side-effect import: register module augmentation for Session/JWT types.
import './types.ts';

export { authConfig } from './config.ts';
export { ForbiddenError, hasRole, requireRole } from './rbac.ts';
export { ALL_ROLES, type AppUser, type Role } from './types.ts';
