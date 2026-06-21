// Route-scoped CSS import for the /welcome landing page. Importing the
// stylesheet here keeps it out of every other route's bundle, and the rules
// are scoped under .vwl (plus :has(.vwl) guards) so nothing leaks into the
// mobile app shell even if the CSS persists across a client-side nav.
import './welcome.css'

export default function WelcomeLayout({ children }) {
  return children
}
