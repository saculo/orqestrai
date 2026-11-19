// The page's two icons, drawn inline so they take the theme's colours.

/** orq's logo: three columns of a board. */
export const BoardIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--yellow)" strokeWidth="2" aria-hidden="true">
    <rect x="3" y="4" width="5" height="16" rx="1.5" />
    <rect x="10" y="4" width="5" height="10" rx="1.5" />
    <rect x="17" y="4" width="4" height="13" rx="1.5" />
  </svg>
)

export const CloseIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--fg2)" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
)
