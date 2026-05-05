'use server';

import { recordAudit } from '@app/db/audit';
import { enqueueDemoJob } from '@app/jobs';
import { revalidatePath } from 'next/cache';
import { auth } from '@/auth';

/**
 * Server action — pushes a demo job onto the BullMQ queue.
 *
 * Pattern for customer projects: validate input (Zod inside @app/jobs),
 * call the typed producer helper, then revalidate any pages that show
 * queue state. Audit logging on each enqueue is OPT-IN per project —
 * shown here to demonstrate how to wire it in.
 */
export const triggerDemoJob = async (): Promise<{ id: string } | { error: string }> => {
  const session = await auth();
  if (!session?.user) return { error: 'unauthorised' };

  const id = await enqueueDemoJob({
    message: `hello from ${session.user.email}`,
    triggeredBy: session.user.id,
  });

  await recordAudit({
    action: 'jobs.demo.enqueued',
    actorId: session.user.id,
    subject: id,
  });

  revalidatePath('/dashboard');
  return { id };
};
