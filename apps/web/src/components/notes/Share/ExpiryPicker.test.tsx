// @vitest-environment jsdom

import { cleanup, fireEvent, render, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ShareTtl } from '@/lib/api/schemas.ts';
import { ExpiryPicker } from './ExpiryPicker.tsx';

afterEach(cleanup);

// Minimal i18n messages covering the keys ExpiryPicker uses.
// Task 23 will fill in real translations; tests target stable roles not text.
const messages = {
  notes: {
    share: {
      expirySet: 'Set an expiry',
      expiryValue: 'Duration value',
      expiryUnit: 'Duration unit',
      unitMinutes: 'minutes',
      unitHours: 'hours',
      unitDays: 'days',
    },
  },
} as const;

const wrap = (ui: React.ReactNode) => (
  <NextIntlClientProvider locale="en" messages={messages as Record<string, unknown>}>
    {ui}
  </NextIntlClientProvider>
);

describe('ExpiryPicker', () => {
  it('renders an unchecked "Set an expiry" checkbox when value is undefined', () => {
    const onChange = vi.fn();
    const { container } = render(wrap(<ExpiryPicker value={undefined} onChange={onChange} />));
    const checkbox = within(container).getByRole('checkbox') as HTMLInputElement;
    expect(checkbox.checked).toBe(false);
  });

  it('does not render the numeric input and select when value is undefined', () => {
    const onChange = vi.fn();
    const { container } = render(wrap(<ExpiryPicker value={undefined} onChange={onChange} />));
    expect(within(container).queryByRole('spinbutton')).toBeNull();
    expect(within(container).queryByRole('combobox')).toBeNull();
  });

  it('checking "Set an expiry" calls onChange with a default {value, unit}', () => {
    const onChange = vi.fn();
    const { container } = render(wrap(<ExpiryPicker value={undefined} onChange={onChange} />));
    fireEvent.click(within(container).getByRole('checkbox'));
    expect(onChange).toHaveBeenCalledOnce();
    const arg = onChange.mock.calls[0]?.[0] as ShareTtl;
    expect(typeof arg.value).toBe('number');
    expect(['minutes', 'hours', 'days']).toContain(arg.unit);
  });

  it('renders the numeric input and select when value is set', () => {
    const onChange = vi.fn();
    const ttl: ShareTtl = { value: 7, unit: 'days' };
    const { container } = render(wrap(<ExpiryPicker value={ttl} onChange={onChange} />));
    const input = within(container).getByRole('spinbutton') as HTMLInputElement;
    const select = within(container).getByRole('combobox') as HTMLSelectElement;
    expect(Number(input.value)).toBe(7);
    expect(select.value).toBe('days');
  });

  it('checkbox is checked when value is set', () => {
    const onChange = vi.fn();
    const { container } = render(
      wrap(<ExpiryPicker value={{ value: 1, unit: 'hours' }} onChange={onChange} />),
    );
    const checkbox = within(container).getByRole('checkbox') as HTMLInputElement;
    expect(checkbox.checked).toBe(true);
  });

  it('unchecking "Set an expiry" when a value is set calls onChange with undefined', () => {
    const onChange = vi.fn();
    const { container } = render(
      wrap(<ExpiryPicker value={{ value: 3, unit: 'hours' }} onChange={onChange} />),
    );
    fireEvent.click(within(container).getByRole('checkbox'));
    expect(onChange).toHaveBeenCalledWith(undefined);
  });

  it('changing the numeric input calls onChange with the new value', () => {
    const onChange = vi.fn();
    const { container } = render(
      wrap(<ExpiryPicker value={{ value: 1, unit: 'days' }} onChange={onChange} />),
    );
    fireEvent.change(within(container).getByRole('spinbutton'), { target: { value: '5' } });
    expect(onChange).toHaveBeenCalledWith({ value: 5, unit: 'days' });
  });

  it('changing the unit select calls onChange with the new unit', () => {
    const onChange = vi.fn();
    const { container } = render(
      wrap(<ExpiryPicker value={{ value: 2, unit: 'hours' }} onChange={onChange} />),
    );
    fireEvent.change(within(container).getByRole('combobox'), { target: { value: 'minutes' } });
    expect(onChange).toHaveBeenCalledWith({ value: 2, unit: 'minutes' });
  });
});
