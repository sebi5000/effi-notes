import { prisma } from '../src/index.ts';

/**
 * Template seed. Intentionally minimal — just enough to verify the
 * database connection and migrations work end-to-end.
 *
 * Customer projects replace or extend this.
 */
const main = async (): Promise<void> => {
  const seedUser = await prisma.user.upsert({
    where: { email: 'seed@example.invalid' },
    update: {},
    create: {
      keycloakSub: 'seed-no-keycloak',
      email: 'seed@example.invalid',
      displayName: 'Seed User',
      roles: ['user'],
    },
  });

  await prisma.auditLog.create({
    data: {
      action: 'system.seed',
      actorId: seedUser.id,
      metadata: { source: 'prisma seed', phase: 'phase-2' } as never,
    },
  });

  console.warn(`Seeded user ${seedUser.id} and one audit log entry`);
};

main()
  .catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
