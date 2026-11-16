/**
 * Remounts when you move to another section of the app (a layout would not), so the new page glides in under the top
 * bar. The sidebar, top bar and ticker live in the layout above this and stay put. Movement only, never a fade, and no
 * transform is left on the wrapper once it ends (app-motion.css .app-in); reduced motion turns it off.
 * Moving within a section (a filter, the next page of a table, a stock inside Markets) does not replay it.
 */
export default function AppTemplate({ children }: { children: React.ReactNode }) {
  return <div className="app-in">{children}</div>;
}
