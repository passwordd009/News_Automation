/**
 * Applies the saved theme before first paint.
 *
 * Without this the page renders in the system theme and then snaps to the
 * chosen one — a visible flash on every navigation. It has to be inline and
 * synchronous in <head>, which is why it is a raw script rather than an effect.
 */
export function ThemeScript() {
  const script = `
(function () {
  try {
    var saved = localStorage.getItem('hestia-theme');
    if (saved === 'light' || saved === 'dark') {
      document.documentElement.setAttribute('data-theme', saved);
    }
  } catch (e) {
    // Private browsing, blocked storage: fall back to the system theme.
  }
})();`;

  return <script dangerouslySetInnerHTML={{ __html: script }} />;
}
