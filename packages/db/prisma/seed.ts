import { resolve } from 'node:path';
import dotenv from 'dotenv';

// Bun --filter sets cwd to the package; load workspace root env files first
// so @app/config/env's validation sees the same values as `prisma migrate`.
const repoRoot = resolve(import.meta.dirname, '../../..');
dotenv.config({ path: [resolve(repoRoot, '.env.local'), resolve(repoRoot, '.env')], quiet: true });

const { prisma } = await import('../src/index.ts');

/**
 * effi-notes seed. Creates a small but believable consulting knowledge base
 * so the UI is alive on first run. Idempotent: each entity is upserted by a
 * stable natural key.
 *
 * Customer projects replace the content; the structure (Users/Folders/Tags/
 * Notes) is the contract the UI expects.
 */

type SeedNote = {
  title: string;
  body: string;
  folderPath: string[];
  tags: string[];
  authorEmail: string;
};

const SEED_AUTHORS = [
  { email: 'seed@example.invalid', displayName: 'Seed User', keycloakSub: 'seed-no-keycloak' },
  { email: 'mara.kessler@example.invalid', displayName: 'Mara Kessler', keycloakSub: 'seed-mara' },
  {
    email: 'jonas.albrecht@example.invalid',
    displayName: 'Jonas Albrecht',
    keycloakSub: 'seed-jonas',
  },
] as const;

const SEED_FOLDERS: Array<{ path: string[]; position: number }> = [
  { path: ['Clients'], position: 0 },
  { path: ['Clients', 'Acme Corp'], position: 0 },
  { path: ['Clients', 'Globex'], position: 1 },
  { path: ['Clients', 'Initech'], position: 2 },
  { path: ['Internal'], position: 1 },
  { path: ['Internal', 'Playbooks'], position: 0 },
  { path: ['Archive'], position: 2 },
];

const SEED_TAGS = [
  { name: 'strategy', color: '#C26A20' },
  { name: 'pricing', color: '#7C3F00' },
  { name: 'workshop', color: '#4B5066' },
  { name: 'discovery', color: '#1E2230' },
  { name: 'playbook', color: '#9B6A2F' },
  { name: 'risk', color: '#A03A2B' },
];

const SEED_NOTES: SeedNote[] = [
  {
    title: 'Acme — Q3 Strategy Review',
    folderPath: ['Clients', 'Acme Corp'],
    tags: ['strategy', 'risk'],
    authorEmail: 'mara.kessler@example.invalid',
    body: [
      '# Acme — Q3 Strategy Review',
      '',
      'Today we reviewed the Q3 roadmap with Acme. Key risks identified:',
      '',
      '- **Vendor lock-in** (high) — three of the top-five tools have <12-month exit clauses',
      '- **Talent ramp** (medium) — two new hires in EU, onboarding into a brittle stack',
      '- **Data-residency** (low, but visible) — DPA clauses pending legal review',
      '',
      '> Decision: phase the rollout. Region by region, starting with DACH.',
      '',
      '## Next steps',
      '',
      '1. Update the rollout deck with the phased plan',
      '2. Confirm legal sign-off on the DPA by end of week',
      '3. Schedule the talent-ramp workshop with the new hires',
    ].join('\n'),
  },
  {
    title: 'Acme — Pricing model options',
    folderPath: ['Clients', 'Acme Corp'],
    tags: ['pricing'],
    authorEmail: 'jonas.albrecht@example.invalid',
    body: [
      '# Pricing model options',
      '',
      'Three viable models for the Acme contract:',
      '',
      '| Model | Pros | Cons |',
      '|---|---|---|',
      '| Per-seat | Predictable, easy to forecast | Caps growth incentive |',
      '| Per-engagement | Aligns with consulting cadence | Lumpy revenue |',
      '| Outcome-based | Strongest narrative | Hard to measure without baseline |',
      '',
      'Recommendation: hybrid — per-seat base + outcome modifier.',
    ].join('\n'),
  },
  {
    title: 'Globex — Discovery workshop notes',
    folderPath: ['Clients', 'Globex'],
    tags: ['workshop', 'discovery'],
    authorEmail: 'mara.kessler@example.invalid',
    body: [
      '# Globex Discovery Workshop',
      '',
      'Attendees: 12, two business owners, one engineer.',
      '',
      '**Themes:**',
      '- Existing reporting pipeline is brittle — manual Friday cron',
      '- Sales ops wants self-service segmentation',
      '- Support team is the unofficial data team (this is the real story)',
      '',
      '*Pull-quote of the day:* "We don\'t need more dashboards, we need fewer better ones."',
    ].join('\n'),
  },
  {
    title: 'Globex — Risk register',
    folderPath: ['Clients', 'Globex'],
    tags: ['risk'],
    authorEmail: 'jonas.albrecht@example.invalid',
    body: [
      '# Risk register — Globex engagement',
      '',
      '- [x] Stakeholder alignment confirmed (sign-off email archived)',
      '- [ ] Data export window not yet scheduled with their IT',
      '- [ ] Backup of legacy CRM still TBD',
    ].join('\n'),
  },
  {
    title: 'Initech — First call summary',
    folderPath: ['Clients', 'Initech'],
    tags: ['discovery'],
    authorEmail: 'mara.kessler@example.invalid',
    body: [
      '# Initech — First call',
      '',
      'Short call, ~30 min. The CTO drove. Two notable signals:',
      '',
      '1. Stack is older than they admit (we counted six "legacy" mentions)',
      '2. They have a board mandate for AI by EOY — pressure is real',
      '',
      'Follow-up: send our discovery questionnaire by Friday.',
    ].join('\n'),
  },
  {
    title: 'Playbook — Workshop facilitation',
    folderPath: ['Internal', 'Playbooks'],
    tags: ['playbook', 'workshop'],
    authorEmail: 'jonas.albrecht@example.invalid',
    body: [
      '# Workshop facilitation playbook',
      '',
      'Heuristic checklist for any client workshop > 6 attendees:',
      '',
      '1. Agenda sent **48 h ahead**, with named owners per section',
      '2. Open with a "what would make this a great use of your time?" round',
      '3. Park scope-creep items on a visible board — do not litigate live',
      '4. End 5 minutes early with three crisp action items + owners',
      '',
      'Reference: [[Globex — Discovery workshop notes]] for a recent run.',
    ].join('\n'),
  },
  {
    title: 'Playbook — Pricing conversations',
    folderPath: ['Internal', 'Playbooks'],
    tags: ['playbook', 'pricing'],
    authorEmail: 'mara.kessler@example.invalid',
    body: [
      '# Pricing conversations playbook',
      '',
      'When a client asks "what does this cost?" too early, redirect to value before number.',
      '',
      '- Anchor on outcome ("what would success look like in six months?")',
      '- Reveal the range only after a value frame is established',
      '- Never quote without a written brief — verbal anchors are sticky and dangerous',
    ].join('\n'),
  },
  {
    title: 'Internal — Strategie-Offsite 2026',
    folderPath: ['Internal'],
    tags: ['strategy', 'workshop'],
    authorEmail: 'jonas.albrecht@example.invalid',
    body: [
      '# Strategie-Offsite 2026',
      '',
      'Ort: Berlin, 12.–14. Juni. Dieses Jahr Fokus auf **Positionierung** statt Wachstum.',
      '',
      '## Themen',
      '',
      '- Wie schärfen wir das Profil als Beratung für mittelständische SaaS-Anbieter?',
      '- Welche zwei Angebote streichen wir 2027?',
      '- Wer übernimmt die Knowledge-Base-Pflege (siehe effi-notes Rollout)?',
    ].join('\n'),
  },
  {
    title: 'Archive — 2025 Q4 retrospective',
    folderPath: ['Archive'],
    tags: ['strategy'],
    authorEmail: 'mara.kessler@example.invalid',
    body: [
      '# Q4 2025 retrospective',
      '',
      'Closed 4 engagements, lost 1, parked 2. Highest-margin work was the discovery sprints.',
      '',
      'Lessons: stop saying yes to fixed-price implementation. We are a discovery house.',
    ].join('\n'),
  },
  {
    title: 'Welcome to effi-notes',
    folderPath: ['Internal'],
    tags: ['playbook'],
    authorEmail: 'seed@example.invalid',
    body: [
      '# Welcome to effi-notes',
      '',
      'This is a markdown knowledge base for the team. A few conventions:',
      '',
      '- Use folders for clients and internal topics',
      '- Use tags for cross-cutting themes (strategy, pricing, workshop…)',
      '- Press `Cmd/Ctrl-K` in the sidebar to search',
      '- Two of you can edit the same note at once — your cursors will be visible',
      '',
      'Happy writing.',
    ].join('\n'),
  },
];

const upsertAuthor = async (
  email: string,
  displayName: string,
  keycloakSub: string,
): Promise<{ id: string; email: string }> => {
  return prisma.user.upsert({
    where: { email },
    update: { displayName },
    create: { email, displayName, keycloakSub, roles: ['user'] },
    select: { id: true, email: true },
  });
};

const upsertFolderPath = async (path: string[], position: number): Promise<string> => {
  let parentId: string | null = null;
  for (let i = 0; i < path.length; i++) {
    const name = path[i];
    if (name === undefined) continue;
    const isLeaf = i === path.length - 1;
    const currentParentId: string | null = parentId;
    const existing: { id: string } | null = await prisma.folder.findFirst({
      where: { name, parentId: currentParentId },
      select: { id: true },
    });
    if (existing) {
      parentId = existing.id;
      continue;
    }
    const created: { id: string } = await prisma.folder.create({
      data: { name, parentId: currentParentId, position: isLeaf ? position : 0 },
      select: { id: true },
    });
    parentId = created.id;
  }
  if (parentId === null) {
    throw new Error(`Failed to upsert folder path: ${path.join('/')}`);
  }
  return parentId;
};

const main = async (): Promise<void> => {
  console.warn('Seeding effi-notes…');

  const authors = new Map<string, string>();
  for (const a of SEED_AUTHORS) {
    const u = await upsertAuthor(a.email, a.displayName, a.keycloakSub);
    authors.set(u.email, u.id);
  }

  const folderIdByPath = new Map<string, string>();
  for (const f of SEED_FOLDERS) {
    const id = await upsertFolderPath(f.path, f.position);
    folderIdByPath.set(f.path.join('/'), id);
  }

  const tagIdByName = new Map<string, string>();
  for (const t of SEED_TAGS) {
    const tag = await prisma.tag.upsert({
      where: { name: t.name },
      update: { color: t.color },
      create: { name: t.name, color: t.color },
      select: { id: true, name: true },
    });
    tagIdByName.set(tag.name, tag.id);
  }

  for (const note of SEED_NOTES) {
    const folderId = folderIdByPath.get(note.folderPath.join('/'));
    const authorId = authors.get(note.authorEmail);
    if (folderId === undefined || authorId === undefined) {
      throw new Error(`Seed note "${note.title}" references unknown folder or author`);
    }
    const existing = await prisma.note.findFirst({
      where: { title: note.title, folderId },
      select: { id: true },
    });
    if (existing) {
      await prisma.note.update({
        where: { id: existing.id },
        data: {
          body: note.body,
          tags: {
            deleteMany: {},
            create: note.tags.map((t) => {
              const tagId = tagIdByName.get(t);
              if (tagId === undefined) {
                throw new Error(`Seed note "${note.title}" references unknown tag "${t}"`);
              }
              return { tagId };
            }),
          },
        },
      });
    } else {
      await prisma.note.create({
        data: {
          title: note.title,
          body: note.body,
          folderId,
          authorId,
          tags: {
            create: note.tags.map((t) => {
              const tagId = tagIdByName.get(t);
              if (tagId === undefined) {
                throw new Error(`Seed note "${note.title}" references unknown tag "${t}"`);
              }
              return { tagId };
            }),
          },
        },
      });
    }
  }

  const seedUser = authors.get('seed@example.invalid');
  if (seedUser !== undefined) {
    await prisma.auditLog.create({
      data: {
        action: 'system.seed',
        actorId: seedUser,
        metadata: { source: 'effi-notes seed' } as never,
      },
    });
  }

  console.warn(
    `Seeded ${authors.size} users · ${folderIdByPath.size} folders · ${tagIdByName.size} tags · ${SEED_NOTES.length} notes`,
  );
};

main()
  .catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
