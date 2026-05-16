'use client';

import { useTranslations } from 'next-intl';
import type { ShareTtl } from '@/lib/api/schemas.ts';

type Props = {
  value: ShareTtl | undefined;
  onChange: (ttl: ShareTtl | undefined) => void;
};

const DEFAULT_TTL: ShareTtl = { value: 7, unit: 'days' };

/**
 * Controlled expiry picker for share TTL. When "forever" is checked the value
 * is undefined (no expiry). When unchecked it renders a numeric input and a
 * unit select that together compose a ShareTtl.
 */
export function ExpiryPicker({ value, onChange }: Props) {
  const t = useTranslations('notes.share');
  const isForever = value === undefined;

  const handleForeverChange = (checked: boolean) => {
    if (checked) {
      onChange(undefined);
    } else {
      onChange(DEFAULT_TTL);
    }
  };

  const handleValueChange = (raw: string) => {
    const num = parseInt(raw, 10);
    if (isNaN(num) || value === undefined) return;
    onChange({ value: num, unit: value.unit });
  };

  const handleUnitChange = (unit: string) => {
    if (value === undefined) return;
    onChange({ value: value.value, unit: unit as ShareTtl['unit'] });
  };

  return (
    <div className="flex flex-col gap-2">
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={isForever}
          onChange={(e) => handleForeverChange(e.target.checked)}
          aria-label={t('expiryForever')}
          className="accent-primary h-4 w-4 rounded"
        />
        <span>{t('expiryForever')}</span>
      </label>

      {!isForever && (
        <div className="flex items-center gap-2">
          <input
            type="number"
            min={1}
            max={1000}
            value={value.value}
            onChange={(e) => handleValueChange(e.target.value)}
            aria-label={t('expiryValue')}
            className="border-input bg-background text-foreground focus:ring-ring w-20 rounded border px-2 py-1 text-sm focus:ring-1 focus:outline-none"
          />
          <select
            value={value.unit}
            onChange={(e) => handleUnitChange(e.target.value)}
            aria-label={t('expiryUnit')}
            className="border-input bg-background text-foreground focus:ring-ring rounded border px-2 py-1 text-sm focus:ring-1 focus:outline-none"
          >
            <option value="minutes">minutes</option>
            <option value="hours">hours</option>
            <option value="days">days</option>
          </select>
        </div>
      )}
    </div>
  );
}
