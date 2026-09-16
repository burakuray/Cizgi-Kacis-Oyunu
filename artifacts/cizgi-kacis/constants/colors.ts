/**
 * Semantic design tokens for the mobile app.
 *
 * These tokens mirror the naming conventions used in web artifacts (index.css)
 * so that multi-artifact projects share a cohesive visual identity.
 *
 * Replace the placeholder values below with values that match the project's
 * brand. If a sibling web artifact exists, read its index.css and convert the
 * HSL values to hex so both artifacts use the same palette.
 *
 * To add dark mode, add a `dark` key with the same token names.
 * The useColors() hook will automatically pick it up.
 */

const colors = {
  light: {
    // Legacy aliases (kept for backward compatibility)
    text: '#0a0a0a',
    tint: '#2f95dc',

    // Core surfaces
    background: '#0B1220',
    foreground: '#F4F7F5',

    // Cards / elevated surfaces
    card: '#111C2E',
    cardForeground: '#F4F7F5',

    // Primary action color (buttons, links, active states)
    primary: '#F28C66',
    primaryForeground: '#ffffff',

    // Secondary / less-emphasis interactive surfaces
    secondary: '#1C2A3D',
    secondaryForeground: '#F4F7F5',

    // Muted / subdued elements (dividers, timestamps, placeholders)
    muted: '#1C2A3D',
    mutedForeground: '#91A1B5',

    // Accent highlights (badges, selected items, focus rings)
    accent: '#B8E7D4',
    accentForeground: '#0B1220',

    // Destructive actions (delete, error states)
    destructive: '#F06D67',
    destructiveForeground: '#ffffff',

    // Borders and input outlines
    border: '#2A3B50',
    input: '#2A3B50',

    // Game tokens
    gameBackground: '#0B1220',
    gameSurface: '#111C2E',
    gameSurfaceRaised: '#17253A',
    gridLine: '#203149',
    obstacle: '#F06D67',
    stone: '#F28C66',
    stoneHighlight: '#FFD5A6',
    goal: '#B8E7D4',
    ink: '#F4F7F5',
  },

  // Border radius (in px). Sync from the sibling web artifact's --radius
  // CSS variable. This value applies to cards, buttons, inputs, and modals.
  radius: 8,
};

export default colors;
