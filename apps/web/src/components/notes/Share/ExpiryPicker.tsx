'use client';

import { useTranslations } from 'next-intl';
import type { ShareTtl } from '@/lib/api/schemas.ts';

type Props = {
  value: ShareTtl | undefined;
  onChange: (ttl: ShareTtl | undefined) => void;
};

const DEFAULT_TTL: ShareTtl = { value: 7, unit: 'days' };

/**
 * Controlled expiry picker for share TTL.
 *
 * The framing is "Set an expiry": the checkbox is OFF by default (no expiry,
 * `value === undefined`); checking it reveals the labelled duration inputs
 * and emits a `ShareTtl`. The `undefined ↔ no expiry` contract is unchanged.
 */
export function ExpiryPicker({ value, onChange }: Props) {
  const t = useTranslations('notes.share');
  const hasExpiry = value !== undefined;

  const handleToggle = (checked: boolean) => {
    onChange(checked ? DEFAULT_TTL : undefined);
  };
  const handleValueChange = (raw: string) => {
    const num = parseInt(raw, 10);
    if (Number.isNaN(num) || value === undefined) return;
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
          checked={hasExpiry}
          onChange={(e) => handleToggle(e.target.checked)}
          aria-label={t('expirySet')}
          className="accent-primary h-4 w-4 rounded"
        />
        <span>{t('expirySet')}</span>
      </label>

      {hasExpiry && (
        <div className="flex items-center gap-2 pl-6">
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
            <option value="minutes">{t('unitMinutes')}</option>
            <option value="hours">{t('unitHours')}</option>
            <option value="days">{t('unitDays')}</option>
          </select>
        </div>
      )}
    </div>
  );
}
