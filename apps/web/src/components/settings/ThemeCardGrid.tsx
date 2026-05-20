// biome-ignore-all lint/a11y/useSemanticElements: card-shaped theme choices with a custom preview body are clearer as button + role="radio" inside a role="radiogroup"; aria-checked gives assistive tech the same semantics as a native <input type="radio">.
'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { THEMES, type ThemeId, type ThemePreview } from '@/lib/theme/themes.ts';

type Props = {
  /** The user's currently-selected theme (resolved on the server). */
  currentTheme: ThemeId;
  /** Optional injectable fetcher for tests. */
  fetcher?: typeof fetch | undefined;
};

/**
 * Selectable cards for the 3 themes (ADR 0029). Each card previews its
 * palette via inlined CSS custom properties on the swatch — the preview
 * shows the theme regardless of the active `<html data-theme>`. Selecting a
 * card PUTs to the theme API and mutates `document.documentElement.dataset.theme`
 * for instant apply.
 */
export function ThemeCardGrid({ currentTheme, fetcher }: Props) {
  const t = useTranslations('settings');
  const [active, setActive] = useState<ThemeId>(currentTheme);
  const [busy, setBusy] = useState<ThemeId | null>(null);
  const [error, setError] = useState<string | null>(null);

  const select = async (id: ThemeId): Promise<void> => {
    if (id === active) return;
    setBusy(id);
    setError(null);
    try {
      const f = fetcher ?? fetch;
      const res = await f('/api/users/me/theme', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ theme: id }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setActive(id);
      document.documentElement.setAttribute('data-theme', id);
    } catch {
      setError(t('themeSaveFailed'));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div>
      {error ? (
        <p role="alert" className="text-destructive mb-2 text-sm">
          {error}
        </p>
      ) : null}
      <div role="radiogroup" aria-label={t('themeLabel')} className="grid grid-cols-3 gap-3">
        {Object.values(THEMES).map((meta) => (
          <ThemeCard
            key={meta.id}
            id={meta.id}
            label={t(meta.i18nKey)}
            preview={meta.preview}
            selected={meta.id === active}
            disabled={busy !== null}
            onSelect={() => void select(meta.id)}
          />
        ))}
      </div>
    </div>
  );
}

function ThemeCard({
  id,
  label,
  preview,
  selected,
  disabled,
  onSelect,
}: {
  id: ThemeId;
  label: string;
  preview: ThemePreview;
  selected: boolean;
  disabled: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      aria-label={label}
      disabled={disabled}
      onClick={onSelect}
      data-theme-id={id}
      className={`flex flex-col gap-2 rounded-md border p-2 text-left text-xs transition ${
        selected
          ? 'border-accent ring-accent/40 ring-2'
          : 'border-paper-line/80 hover:border-accent/60'
      } ${disabled ? 'opacity-60' : ''}`}
    >
      <div
        className="h-20 w-full rounded-sm border"
        style={{
          background: preview.background,
          borderColor: preview.paperLine,
        }}
      >
        <div className="flex h-full flex-col justify-between p-2">
          <div style={{ color: preview.foreground, fontSize: '0.7rem', fontWeight: 600 }}>Aa</div>
          <div className="flex gap-1">
            <span
              className="block h-1.5 w-1.5 rounded-full"
              style={{ background: preview.accent }}
              aria-hidden="true"
            />
            <span
              className="block h-1.5 flex-1 rounded-full"
              style={{ background: preview.muted }}
              aria-hidden="true"
            />
          </div>
        </div>
      </div>
      <span className="text-foreground">{label}</span>
    </button>
  );
}
