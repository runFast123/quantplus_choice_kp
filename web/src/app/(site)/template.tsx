/**
 * Remounts on every page change inside the public site (a layout would not), so each new page glides in under the
 * navbar, which lives in the layout and stays put. Movement only, never a fade; reduced motion turns it off.
 */
export default function SiteTemplate({ children }: { children: React.ReactNode }) {
  return <div className="page-in">{children}</div>;
}
