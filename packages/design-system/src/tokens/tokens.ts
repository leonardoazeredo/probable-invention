/**
 * Design tokens. This file is the only place raw design values may appear.
 * Feature code consumes tokens through CSS custom properties or this object.
 */
export const tokens = {
  color: {
    actionPrimary: '#1d4ed8',
    actionPrimaryHover: '#1e40af',
    onAction: '#ffffff',
    actionSecondary: '#e5e7eb',
    onSecondary: '#111827',
    focusRing: '#f59e0b',
  },
  space: { xs: '4px', sm: '8px', md: '12px', lg: '16px' },
  radius: { md: '6px' },
  font: { body: '16px' },
} as const;

export type Tokens = typeof tokens;
