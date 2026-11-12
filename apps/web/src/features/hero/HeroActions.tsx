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
 * (Sections / Hero Actions, Platform=Desktop: Text Content Title + Button Group).
 * Composes the canonical Button; layout and type come from tokens.
 * Known gap: no mobile breakpoint yet (SDS swaps to Title Page on mobile).
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
        background: tokens.color.surfaceSecondary,
        color: tokens.color.textDefault,
        fontFamily: tokens.font.family,
        padding: `${tokens.space.sectionLarge} ${tokens.space.xl}`,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: tokens.space.xxl,
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: tokens.space.sm, textAlign: 'center' }}>
        <h1
          id={headingId}
          style={{
            margin: 0,
            fontSize: tokens.font.titleHero,
            fontWeight: tokens.font.weightBold,
            lineHeight: tokens.font.titleHeroLineHeight,
            letterSpacing: tokens.font.titleHeroLetterSpacing,
          }}
        >
          {title}
        </h1>
        {subtitle && (
          <p
            style={{
              margin: 0,
              color: tokens.color.textSecondary,
              fontSize: tokens.font.subtitle,
              fontWeight: tokens.font.weightRegular,
              lineHeight: tokens.font.subtitleLineHeight,
            }}
          >
            {subtitle}
          </p>
        )}
      </div>
      <div style={{ display: 'flex', gap: tokens.space.lg, width: tokens.layout.heroActionsWidth }}>
        <Button variant="secondary" onClick={onSecondary} style={{ flex: 1 }}>
          {secondaryLabel}
        </Button>
        <Button onClick={onPrimary} style={{ flex: 1 }}>
          {primaryLabel}
        </Button>
      </div>
    </section>
  );
}
