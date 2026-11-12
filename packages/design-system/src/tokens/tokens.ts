/**
 * Design tokens. This file is the only place raw design values may appear.
 * Feature code consumes tokens through CSS custom properties or this object.
 *
 * Values come from Figma's Simple Design System (SDS), light theme:
 * https://www.figma.com/community/file/1380235722331273046/simple-design-system
 * exported variables: https://github.com/figma/sds/blob/main/scripts/tokens/tokens.json
 * (MIT licensed). The SDS variable each value maps to is noted alongside it.
 */
export const tokens = {
  color: {
    actionPrimary: '#2c2c2c', // Background/Brand/Default (brand-800)
    actionPrimaryHover: '#1e1e1e', // Background/Brand/Hover (brand-900)
    onAction: '#f5f5f5', // Text/Brand/On Brand (brand-100)
    actionSecondary: '#e3e3e3', // Background/Neutral/Tertiary (slate-200)
    onSecondary: '#303030', // Text/Neutral/Default (slate-900)
    focusRing: '#006aff', // SDS global focus ring
    surface: '#ffffff', // Background/Default/Default (white-1000)
    surfaceSecondary: '#f5f5f5', // Background/Default/Secondary (gray-100)
    borderSecondary: '#767676', // Border/Neutral/Secondary (slate-600)
    borderBrand: '#2c2c2c', // Border/Brand/Default (brand-800)
    textDefault: '#1e1e1e', // Text/Default/Default (gray-900)
    textSecondary: '#757575', // Text/Default/Secondary (gray-500)
  },
  space: {
    xs: '4px', // Space/100
    sm: '8px', // Space/200
    md: '12px', // Space/300
    lg: '16px', // Space/400
    xl: '24px', // Space/600
    xxl: '32px', // Space/800
    section: '64px', // Space/1600
    sectionLarge: '160px', // Space/4000
  },
  radius: { md: '8px' }, // Radius/200
  stroke: { border: '1px' }, // Stroke/Border
  layout: { heroActionsWidth: '240px' }, // Hero Actions Button Group width (fixed in the frame; no SDS variable)
  font: {
    family: 'Inter, sans-serif', // Typography/Family/Sans
    body: '16px', // Body/Size/Medium (scale-03)
    subtitle: '32px', // Subtitle/Size/Base (scale-06)
    titleHero: '72px', // Title Hero/Size (scale-10)
    titleHeroLineHeight: 1.2, // Title Hero text style: line height 120%
    titleHeroLetterSpacing: '-0.03em', // Title Hero text style: letter spacing -3%
    subtitleLineHeight: 1.2, // Subtitle text style: line height 120%
    weightRegular: 400,
    weightBold: 700,
  },
} as const;

export type Tokens = typeof tokens;
