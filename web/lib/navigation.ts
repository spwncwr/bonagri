/*
 * Shared "back" behaviour for standalone screens (checkout, addresses,
 * requests, apply).
 *
 * The button must return to the screen the buyer came from, so history.back()
 * is used whenever an in-app screen is known to sit behind the current one.
 * Two signals prove that:
 *   - the document was loaded at a different URL than the current one, i.e.
 *     the App Router pushed at least one in-app entry since the load; or
 *   - the document was hard-loaded with a same-origin referrer, i.e. the
 *     previous screen was also this app.
 *
 * Anything else is a fresh deep link (typed URL, bookmark, new tab whose
 * first entry is about:blank) — there is no in-app screen to return to, so we
 * push a sensible hub instead of history.back()-ing out of the app.
 */

type BackRouter = {
  back: () => void;
  push: (href: string) => void;
};

export function goBackOr(router: BackRouter, fallback: string): void {
  const nav = performance.getEntriesByType("navigation")[0];
  const loadedAt = nav ? nav.name : "";
  let fromApp = loadedAt !== "" && loadedAt !== window.location.href;

  if (!fromApp && document.referrer) {
    try {
      fromApp = new URL(document.referrer).origin === window.location.origin;
    } catch {
      fromApp = false;
    }
  }

  if (fromApp) {
    router.back();
  } else {
    router.push(fallback);
  }
}
