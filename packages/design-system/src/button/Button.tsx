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
        color: primary ? tokens.color.onAction : tokens.color.textDefault,
        // Figma strokes sit inside the frame, so the border eats into the padding
        // and the button keeps SDS's 40px height.
        padding: `calc(${tokens.space.md} - ${tokens.stroke.border})`,
        borderRadius: tokens.radius.md,
        border: `${tokens.stroke.border} solid ${primary ? tokens.color.borderBrand : tokens.color.borderSecondary}`,
        fontFamily: tokens.font.family,
        fontSize: tokens.font.body,
        lineHeight: 1,
        cursor: 'pointer',
        ...style,
      }}
      {...rest}
    />
  );
}
