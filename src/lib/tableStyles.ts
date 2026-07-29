// Shared table-striping helpers for the Security pages.
//
// These are written as whole-sx *functions* (`sx={zebraSx}`), not objects with a
// per-property theme callback nested under a selector — MUI only resolves theme
// callbacks at the top level of an sx function, so the nested-callback form
// silently produces no colour.

// Light value is intentionally a touch stronger than the theme's near-white
// #f8f9fd, which is imperceptible on a light card; dark keeps its subtle lift.
const alt = (theme: any) =>
  theme.palette.mode === 'dark' ? 'rgba(255, 255, 255, 0.04)' : '#eef1f8';

// Zebra-stripe a flat table's body rows, matching the site's alternate-row tint.
export const zebraSx = (theme: any) => ({
  '& tbody tr:nth-of-type(even)': { backgroundColor: alt(theme) },
});

// For a master/expandable table whose rows contain nested tables: cancel the
// theme's even-row tint on THIS table's *direct* rows only, so the expand/detail
// rows don't tint the nested tables.
export const flatRowsSx = {
  '& > tbody > tr:nth-of-type(even)': { backgroundColor: 'transparent' },
};

// Index-based stripe for one row of a master/expandable table (each item renders a
// data row + a hidden detail row, so nth-of-type can't be used). Tints odd indices.
export const stripeRowSx = (index: number) => (theme: any) => ({
  backgroundColor: index % 2 === 1 ? alt(theme) : 'transparent',
});
