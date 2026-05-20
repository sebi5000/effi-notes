'use server';

import { signOut } from '@/auth';

/** Sign out from the UserMenu — same `redirectTo: '/'` as the dashboard. */
export async function signOutAction(): Promise<void> {
  await signOut({ redirectTo: '/' });
}
