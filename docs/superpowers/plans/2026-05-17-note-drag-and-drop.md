# Note Drag-and-Drop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user drag a sidebar note onto a folder to file/move it, or onto the folder-tree root to un-file it.

**Architecture:** Pure frontend. Extends the existing hand-rolled HTML5 drag-and-drop (used for folder reorder) with a distinct note MIME type. Note rows become draggable; folder rows and the tree root accept a note drop and call a move handler that `PATCH`es the note's `folderId`. No backend, schema, or migration changes — `PATCH /api/notes/[id]` already accepts `folderId` and enforces access.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 6 strict, Vitest + jsdom + @testing-library/react, TailwindCSS 4.

**Spec:** `docs/superpowers/specs/2026-05-17-note-drag-and-drop-design.md`

**Conventions:** TDD where the task specifies a test. TypeScript strict (no `any` without `// reason:`). Conventional Commits. lefthook pre-commit runs on commit and MUST pass — never `--no-verify`. Run tests with `bun run vitest run <path>` from the repo root. `timeout` is unavailable on macOS. Commit directly to `main` (trunk-based, user-consented).

---

## Task 1: Shared DnD MIME module

**Files:**
- Create: `apps/web/src/lib/notes/dnd.ts`
- Modify: `apps/web/src/components/notes/Sidebar/FolderTree.tsx`

This is a refactor (no behaviour change) — verification is the existing FolderTree tests staying green.

- [ ] **Step 1: Create the MIME module**

Create `apps/web/src/lib/notes/dnd.ts`:
```ts
/** dataTransfer MIME for a sidebar folder drag (reorder / reparent). */
export const FOLDER_DND_MIME = 'application/x-effi-folder';
/** dataTransfer MIME for a sidebar note drag (move into / between folders). */
export const NOTE_DND_MIME = 'application/x-effi-note';
```

- [ ] **Step 2: Use it in `FolderTree.tsx`**

In `apps/web/src/components/notes/Sidebar/FolderTree.tsx`:
- Add the import: `import { FOLDER_DND_MIME } from '@/lib/notes/dnd.ts';`
- Delete the local line `const DND_MIME = 'application/x-effi-folder';`
- Replace every remaining reference to `DND_MIME` with `FOLDER_DND_MIME` (there are uses in `onRowDragStart`, `onZoneDrop`, and `onRootDrop` — `grep -n DND_MIME` the file to find them all).

- [ ] **Step 3: Verify**

Run: `bun run vitest run apps/web/src/components/notes/Sidebar/FolderTree.test.tsx`
Expected: PASS — all existing folder-DnD tests still pass.
Run: `bun run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/notes/dnd.ts apps/web/src/components/notes/Sidebar/FolderTree.tsx
git commit -m "refactor(notes): shared DnD MIME module"
```

---

## Task 2: Note rows become draggable

**Files:**
- Modify: `apps/web/src/components/notes/Sidebar/index.tsx`
- Modify: `apps/web/src/components/notes/Sidebar/Sidebar.test.tsx`

- [ ] **Step 1: Write the failing test**

First read `apps/web/src/components/notes/Sidebar/index.tsx` (the `notes.map` row render) and `Sidebar.test.tsx` (its render harness + the existing `noteMutations` tests from the prior feature).

In `Sidebar.test.tsx`, add a test in the note-mutations describe block: render `Sidebar` with `noteMutations` and a note; locate the note's `<li>` row element (e.g. `screen.getByText(<note title>).closest('li')`); assert it has `draggable` set to `true`; fire a `dragStart` on it with a stub `dataTransfer`, and assert `setData` was called with `NOTE_DND_MIME` (import it from `@/lib/notes/dnd.ts`) and the note's id. Use a `dataTransfer` stub like:
```ts
const makeDataTransfer = () => {
  const store: Record<string, string> = {};
  return {
    data: store,
    types: [] as string[],
    dropEffect: 'none',
    effectAllowed: 'none',
    setData(type: string, val: string) {
      store[type] = val;
      this.types = Object.keys(store);
    },
    getData(type: string) {
      return store[type] ?? '';
    },
  };
};
```
Mirror the `dataTransfer` stub the existing `FolderTree.test.tsx` DnD tests already use, if it has one — keep one consistent style.

- [ ] **Step 2: Run it to verify it fails**

Run: `bun run vitest run apps/web/src/components/notes/Sidebar/Sidebar.test.tsx`
Expected: FAIL — the note row is not draggable.

- [ ] **Step 3: Make note rows draggable**

In `apps/web/src/components/notes/Sidebar/index.tsx`:
- Add the import: `import { NOTE_DND_MIME } from '@/lib/notes/dnd.ts';`
- Add component state near the other sidebar state: `const [draggingNoteId, setDraggingNoteId] = useState<string | null>(null);`
- On each note's `<li>` element in the `notes.map` render, add:
  - `draggable={noteMutations !== undefined && !isRenaming}`
  - `onDragStart={(e) => { e.dataTransfer.setData(NOTE_DND_MIME, n.id); e.dataTransfer.effectAllowed = 'move'; setDraggingNoteId(n.id); }}`
  - `onDragEnd={() => setDraggingNoteId(null)}`
  - append `${draggingNoteId === n.id ? 'opacity-50' : ''}` to the `<li>`'s `className`.
  Guard `onDragStart`/`onDragEnd` so they are no-ops when `noteMutations` is undefined (or only attach them when `noteMutations` is set) — keep behaviour unchanged when the sidebar is read-only.

- [ ] **Step 4: Run it to verify it passes**

Run: `bun run vitest run apps/web/src/components/notes/Sidebar/Sidebar.test.tsx`
Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/notes/Sidebar/index.tsx apps/web/src/components/notes/Sidebar/Sidebar.test.tsx
git commit -m "feat(notes): make sidebar note rows draggable"
```

---

## Task 3: FolderTree accepts a note drop

**Files:**
- Modify: `apps/web/src/components/notes/Sidebar/FolderTree.tsx`
- Modify: `apps/web/src/components/notes/Sidebar/FolderTree.test.tsx`

- [ ] **Step 1: Write the failing tests**

First read `FolderTree.tsx` (the `Props` type, `FolderRow`, the `folder-tree-root` div, the `actionError` state) and `FolderTree.test.tsx` (its DnD test harness + `dataTransfer` stub).

In `FolderTree.test.tsx`, add tests (with `NOTE_DND_MIME` imported from `@/lib/notes/dnd.ts` and a `dataTransfer` stub whose `types` includes `NOTE_DND_MIME` and whose `getData(NOTE_DND_MIME)` returns a note id):
- Render `FolderTree` with `folders` and an `onNoteDrop` spy (`vi.fn().mockResolvedValue(undefined)`). Fire `drop` on a folder row's element carrying a note `dataTransfer`; assert `onNoteDrop` was called with `(noteId, thatFolderId)`.
- Fire `drop` on the `folder-tree-root` element (`data-testid="folder-tree-root"`) with a note `dataTransfer`; assert `onNoteDrop` was called with `(noteId, null)`.
- Fire a folder-reorder `drop` (a `dataTransfer` carrying `FOLDER_DND_MIME`) and assert `onNoteDrop` was NOT called (folder drags still go through the reorder path).

- [ ] **Step 2: Run them to verify they fail**

Run: `bun run vitest run apps/web/src/components/notes/Sidebar/FolderTree.test.tsx`
Expected: FAIL — `onNoteDrop` is never called.

- [ ] **Step 3: Implement note-drop in `FolderTree.tsx`**

- Add the import: `import { FOLDER_DND_MIME, NOTE_DND_MIME } from '@/lib/notes/dnd.ts';` (replace the Task-1 single-import line).
- Add to the `Props` type:
  ```ts
  /** When set, folder rows + the root accept a dropped note; arg is the new folderId (null = un-file). */
  onNoteDrop?: (noteId: string, folderId: string | null) => Promise<void>;
  ```
  Destructure `onNoteDrop` in the component signature.
- Add state: `const [noteDropTargetId, setNoteDropTargetId] = useState<string | null>(null);` (value is a folder id, the string `'__root__'`, or `null`).
- Add a helper that resolves + persists a note drop, routing failures to the existing `actionError`:
  ```ts
  const applyNoteDrop = async (noteId: string, folderId: string | null): Promise<void> => {
    if (!onNoteDrop) return;
    try {
      await onNoteDrop(noteId, folderId);
      setActionError(null);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'move failed');
    }
  };
  ```
- Add curried per-row note-drop DOM handlers:
  ```ts
  const onRowNoteDragOver = (folderId: string) => (e: DragEvent<HTMLDivElement>) => {
    if (!onNoteDrop || !e.dataTransfer.types.includes(NOTE_DND_MIME)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setNoteDropTargetId((prev) => (prev === folderId ? prev : folderId));
  };
  const onRowNoteDrop = (folderId: string) => (e: DragEvent<HTMLDivElement>) => {
    if (!onNoteDrop || !e.dataTransfer.types.includes(NOTE_DND_MIME)) return;
    e.preventDefault();
    e.stopPropagation();
    const noteId = e.dataTransfer.getData(NOTE_DND_MIME);
    setNoteDropTargetId(null);
    if (noteId) void applyNoteDrop(noteId, folderId);
  };
  ```
- Pass to each `<FolderRow>`: `isNoteDropTarget={noteDropTargetId === row.id}`, and (only when `onNoteDrop` is set) `onNoteDragOver={onRowNoteDragOver(row.id)}` and `onNoteDrop={onRowNoteDrop(row.id)}`.
- In `RowProps`, add `isNoteDropTarget: boolean` and optional `onNoteDragOver?`/`onNoteDrop?` (`(e: DragEvent<HTMLDivElement>) => void`). In `FolderRow`, attach `onDragOver={onNoteDragOver}` and `onDrop={onNoteDrop}` to the root `<div role="treeitem">` (these coexist with the existing folder DropZone children — those render only during a folder drag), and add to the row's `className` the highlight `${isNoteDropTarget ? 'bg-accent-soft/40 ring-accent ring-1' : ''}` (same look as a folder "inside" drop).
- Extend the `folder-tree-root` handlers for note drops. The current `onRootDragOver`/`onRootDrop` early-return when there is no folder drag. Make them also handle a note drag:
  ```ts
  const onRootDragOver = (e: DragEvent<HTMLDivElement>) => {
    if (!dndEnabled) return;
    if (onNoteDrop && e.dataTransfer.types.includes(NOTE_DND_MIME)) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      setNoteDropTargetId((prev) => (prev === '__root__' ? prev : '__root__'));
      return;
    }
    if (draggingId === null) return;
    const dragged = folders.find((f) => f.id === draggingId);
    if (!dragged || dragged.parentId === null) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDropTarget((prev) => (prev !== null && prev.id === '__root__' ? prev : { id: '__root__', mode: 'inside' }));
  };
  const onRootDragLeave = () => {
    setDropTarget((prev) => (prev !== null && prev.id === '__root__' ? null : prev));
    setNoteDropTargetId((prev) => (prev === '__root__' ? null : prev));
  };
  const onRootDrop = (e: DragEvent<HTMLDivElement>) => {
    if (!dndEnabled) return;
    if (onNoteDrop && e.dataTransfer.types.includes(NOTE_DND_MIME)) {
      e.preventDefault();
      const noteId = e.dataTransfer.getData(NOTE_DND_MIME);
      setNoteDropTargetId(null);
      if (noteId) void applyNoteDrop(noteId, null);
      return;
    }
    e.preventDefault();
    const draggedId = e.dataTransfer.getData(FOLDER_DND_MIME) || draggingId;
    setDraggingId(null);
    setDropTarget(null);
    if (!draggedId) return;
    void applyDrop(draggedId, { id: '__root__', mode: 'inside' });
  };
  ```
  (Adjust to match the file's exact current root handlers — the key additions are the `NOTE_DND_MIME` branches; keep the existing folder behaviour intact.)
- The root container's highlight `className` already keys on `dropTarget?.id === '__root__'` — extend it to `dropTarget?.id === '__root__' || noteDropTargetId === '__root__'`.
- Note-drop handlers must be attached to the root container regardless of `dndEnabled` only when `onNoteDrop` is set — if `onNoteDrop` is set but `mutations.onReorder` is not (`dndEnabled` false), wire the root note-drop too. Simplest: gate the root `onDragOver`/`onDrop`/`onDragLeave` attachment on `dndEnabled || onNoteDrop !== undefined`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun run vitest run apps/web/src/components/notes/Sidebar/FolderTree.test.tsx`
Expected: PASS (all tests, including the pre-existing folder-reorder DnD tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/notes/Sidebar/FolderTree.tsx apps/web/src/components/notes/Sidebar/FolderTree.test.tsx
git commit -m "feat(notes): folder rows + root accept a dropped note"
```

---

## Task 4: Move handler in NotesShell + Sidebar wiring

**Files:**
- Modify: `apps/web/src/components/notes/NotesShell.tsx`
- Modify: `apps/web/src/components/notes/Sidebar/index.tsx`

- [ ] **Step 1: Add `refreshNotes` + `handleMoveNote` to `NotesShell`**

First read `apps/web/src/components/notes/NotesShell.tsx` — note the existing notes-list `useEffect` (keyed on `folderId`/`tagId`, with a `cancelled` guard), `notes`/`setNotes`/`setPending` state, `byUpdatedAtDesc`, and the `noteMutations` object passed to `<Sidebar>`.

- Add a request-id ref: `const notesReqRef = useRef(0);` (import `useRef`).
- Add a `refreshNotes` `useCallback` that performs the list fetch, cancel-safe via the ref so a stale fetch never overwrites a newer one:
  ```ts
  const refreshNotes = useCallback(async () => {
    const reqId = ++notesReqRef.current;
    setPending(true);
    try {
      const list = await notesApi.list({
        ...(folderId !== null ? { folderId } : {}),
        ...(tagId !== null ? { tagId } : {}),
      });
      if (notesReqRef.current === reqId) setNotes(byUpdatedAtDesc(list.notes));
    } catch {
      // keep the previous list on error
    } finally {
      if (notesReqRef.current === reqId) setPending(false);
    }
  }, [folderId, tagId]);
  ```
- Replace the body of the existing filter `useEffect` with `void refreshNotes();` and set its dependency array to `[refreshNotes]` (drop the now-unneeded inline `cancelled` flag — the ref handles staleness).
- Add `handleMoveNote`:
  ```ts
  const handleMoveNote = useCallback(
    async (noteId: string, targetFolderId: string | null) => {
      const note = notes.find((n) => n.id === noteId);
      if (note && note.folderId === targetFolderId) return; // no-op: already there
      await notesApi.patch(noteId, { folderId: targetFolderId });
      await refreshNotes();
    },
    [notes, refreshNotes],
  );
  ```
- Add `onMove: handleMoveNote` to the `noteMutations` object passed to `<Sidebar>`.

- [ ] **Step 2: Wire `Sidebar` → `FolderTree`**

In `apps/web/src/components/notes/Sidebar/index.tsx`:
- Add `onMove: (noteId: string, folderId: string | null) => Promise<void>;` to the `noteMutations` field of the `Props` type.
- Where `Sidebar` renders `<FolderTree …>`, pass `onNoteDrop={noteMutations?.onMove}`.

- [ ] **Step 3: Verify**

Run: `bun run typecheck`
Expected: PASS (all 8 packages). Fix any prop-type fallout in `NotesShell`/`Sidebar` callers or test fixtures.
Run: `bun run vitest run apps/web/src/components/notes`
Expected: PASS — all component tests, including the Task 2/3 DnD tests, now that the wiring compiles.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/notes/NotesShell.tsx apps/web/src/components/notes/Sidebar/index.tsx
git commit -m "feat(notes): move a dropped note via PATCH folderId"
```

---

## Task 5: Full verification

**Files:** none (verification only; `vitest.config.ts` only if a coverage gap is found).

- [ ] **Step 1: Full test suite**

Run: `bun run vitest run`
Expected: all test files pass. `apps/web/src/lib/notes/dnd.ts` is covered by the existing `apps/web/src/lib/notes/**/*.ts` coverage glob — no `vitest.config.ts` change is expected. If the coverage gate fails for a genuinely-uncovered new file, add it to the `include` array and re-run.

- [ ] **Step 2: Typecheck**

Run: `bun run typecheck`
Expected: all 8 packages exit 0.

- [ ] **Step 3: Production build (Turbopack)**

Run: `bun --filter @app/web build`
Expected: exit 0. Catches Turbopack-only compile errors that `vitest`/`tsc` miss. If it fails, fix the reported file and re-run Steps 1–3.

- [ ] **Step 4: Commit (only if a coverage-config change was needed)**

```bash
git add vitest.config.ts
git commit -m "test(notes): coverage wiring for note drag-and-drop"
```
Otherwise nothing to commit.

---

## Self-Review

**Spec coverage:**
- Shared MIME constants → Task 1.
- Note rows draggable (§2 of the spec) → Task 2.
- Folder rows accept a note drop (§3) → Task 3.
- Root drop un-files (§4) → Task 3 (the `folder-tree-root` `NOTE_DND_MIME` branches).
- Move handler + `refreshNotes` + no-op skip + error surfacing (§5) → Task 4 (`handleMoveNote`) + Task 3 (`applyNoteDrop` routes failure to `actionError`).
- `FolderTree` import refactor → Task 1.
- Tests → Tasks 2 and 3; full verification → Task 5.

**Placeholder scan:** No "TBD"/"implement later". Task 3's root-handler block says "adjust to match the file's exact current root handlers" — the current handlers are quoted in full from the live file so the engineer has the exact before/after; the only additions are the clearly-shown `NOTE_DND_MIME` branches.

**Type consistency:** `NOTE_DND_MIME` / `FOLDER_DND_MIME` defined in Task 1, used in Tasks 2 and 3. `onNoteDrop: (noteId: string, folderId: string | null) => Promise<void>` is the signature in `FolderTree`'s `Props` (Task 3), the `noteMutations.onMove` field (Task 4), and `NotesShell.handleMoveNote` (Task 4) — identical. `noteDropTargetId` is the single state name throughout Task 3. The `FolderRow` props `isNoteDropTarget`/`onNoteDragOver`/`onNoteDrop` are defined and consumed within Task 3.
