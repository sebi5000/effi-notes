'use client';

export type PresenceUser = {
  clientId: number;
  initials: string;
  colorHex: string;
};

type Props = {
  users: ReadonlyArray<PresenceUser>;
};

export function PresenceBar({ users }: Props) {
  if (users.length === 0) return null;
  return (
    <ul aria-label="presence" className="flex -space-x-1.5">
      {users.slice(0, 6).map((u) => (
        <li key={u.clientId} className="relative">
          <span
            title={u.initials}
            className="border-background flex h-7 w-7 items-center justify-center rounded-full border-2 text-xs font-medium text-white shadow-sm"
            style={{ backgroundColor: u.colorHex }}
          >
            {u.initials}
          </span>
        </li>
      ))}
      {users.length > 6 ? (
        <li className="text-muted-foreground border-background bg-muted flex h-7 w-7 items-center justify-center rounded-full border-2 text-xs">
          +{users.length - 6}
        </li>
      ) : null}
    </ul>
  );
}

/** Pure helper extracted for unit testing. Derives the initials from a name. */
export const initialsFromName = (name: string | null | undefined): string => {
  if (!name) return '?';
  const parts = name
    .trim()
    .split(/\s+/)
    .filter((p) => p.length > 0);
  if (parts.length === 0) return '?';
  if (parts.length === 1) {
    const first = parts[0] ?? '';
    return first.slice(0, 2).toUpperCase();
  }
  return `${parts[0]?.[0] ?? ''}${parts.at(-1)?.[0] ?? ''}`.toUpperCase();
};
