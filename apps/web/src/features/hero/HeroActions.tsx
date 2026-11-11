import { useId } from 'react';
import { Button, tokens } from '@pi/design-system';

export interface HeroActionsProps {
  title: string;
  subtitle?: string;
  primaryLabel: string;
  secondaryLabel: string;
  onPrimary: () => void;
  onSecondary: () => void;
}

/**
 * "Hero Actions" section from Figma's Simple Design System
 * (Sections / Hero Actions: Text Content Title + Button Group).
 * Composes the canonical Button; layout and type come from tokens.
 */
export function HeroActions({
  title,
  subtitle,
  primaryLabel,
  secondaryLabel,
  onPrimary,
  onSecondary,
}: HeroActionsProps) {
  const headingId = useId();
  return (
    <section
      aria-labelledby={headingId}
      style={{
        background: tokens.color.surface,
        color: tokens.color.textDefault,
        fontFamily: tokens.font.family,
        padding: tokens.space.section,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: tokens.space.xl,
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: tokens.space.sm, textAlign: 'center' }}>
        <h1
          id={headingId}
          style={{ margin: 0, fontSize: tokens.font.titleHero, fontWeight: tokens.font.weightBold }}
        >
          {title}
        </h1>
        {subtitle && (
          <p style={{ margin: 0, fontSize: tokens.font.subtitle, fontWeight: tokens.font.weightRegular }}>
            {subtitle}
          </p>
        )}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: tokens.space.md }}>
        <Button variant="secondary" onClick={onSecondary}>
          {secondaryLabel}
        </Button>
        <Button onClick={onPrimary}>{primaryLabel}</Button>
      </div>
    </section>
  );
}
