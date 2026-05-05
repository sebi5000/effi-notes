import { getQueueForBullBoard, QUEUES } from '@app/jobs/queues';
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { BunAdapter } from '@bull-board/bun';

/**
 * Build a Bun routes object that mounts Bull Board under /admin/queues.
 *
 * Mounted on the worker's internal HTTP port (default 3100). Never
 * exposed to the public — apps/web's middleware enforces auth + the
 * `ops` role and proxies to this port over the internal Compose network.
 */
export const buildBullBoardRoutes = (): Record<
  string,
  Record<string, (req: Request) => Response | Promise<Response>>
> => {
  const serverAdapter = new BunAdapter();
  serverAdapter.setBasePath('/admin/queues');

  createBullBoard({
    queues: Object.values(QUEUES).map((name) => new BullMQAdapter(getQueueForBullBoard(name))),
    serverAdapter,
  });

  return serverAdapter.getRoutes();
};
