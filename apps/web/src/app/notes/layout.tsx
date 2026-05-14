import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { auth } from '@/auth';

export default async function NotesLayout({ children }: { children: ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect('/login?from=/notes');
  return <>{children}</>;
}
