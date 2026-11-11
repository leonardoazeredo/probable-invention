import type { ButtonHTMLAttributes, Ref } from 'react';
import { tokens } from '../tokens/tokens.js';

export type ButtonVariant = 'primary' | 'secondary';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  ref?: Ref<HTMLButtonElement>;
}

/** The canonical button. Features compose this; they never re-implement it. */
export function Button({ variant = 'primary', type = 'button', style, ...rest }: ButtonProps) {
  const primary = variant === 'primary';
  return (
    <button
      type={type}
      style={{
        background: primary ? tokens.color.actionPrimary : tokens.color.actionSecondary,
        color: primary ? tokens.color.onAction : tokens.color.onSecondary,
        padding: `${tokens.space.sm} ${tokens.space.lg}`,
        borderRadius: tokens.radius.md,
        border: 'none',
        fontSize: tokens.font.body,
        cursor: 'pointer',
        ...style,
      }}
      {...rest}
    />
  );
}
