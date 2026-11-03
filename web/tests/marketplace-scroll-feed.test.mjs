import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const src = readFileSync(
  fileURLToPath(
    new URL("../components/marketplace/home-shell.tsx", import.meta.url),
  ),
  "utf8",
);

function block(start, end) {
  const from = src.indexOf(start);
  assert.notEqual(from, -1, `${start} missing from the marketplace shell`);
  const to = src.indexOf(end, from);
  assert.notEqual(to, -1, `${end} missing after ${start}`);
  return src.slice(from, to);
}

test("buyer listings have no manual load-more control", () => {
  assert.equal(src.includes("Load more products"), false);
  assert.equal(src.includes("View all {filteredProducts.length} products"), false);
});

test("the scroll feed owns the sentinel, skeleton and retry states", () => {
  const feed = block(
    "function ProductScrollFeed({",
    "\nfunction formatOrderDate",
  );
  // The sentinel is a 1px marker so it always has a measurable position.
  assert.match(feed, /ref=\{onSentinel\}[^>]*className="h-px w-full"/);
  assert.match(feed, /\{hasMore && !error \?/);
  assert.match(feed, /<MoreProductsSkeleton count=\{3\} \/>/);
  assert.match(feed, /onClick=\{onRetry\}/);
  assert.match(feed, /aria-live="polite"/);
});

test("the scroll feed measures the mounted sentinel, not a stale ref", () => {
  assert.match(
    src,
    /const \[sentinelNode, setSentinelNode\] = useState<HTMLDivElement \| null>\(null\);/,
  );
  const effect = block(
    "if (!sentinelNode || !scrollFeedReady) return;",
    "const loadOrders = useCallback",
  );
  assert.match(
    effect,
    /sentinelNode\.getBoundingClientRect\(\)\.top - window\.innerHeight/,
  );
  assert.match(effect, /distance <= SCROLL_FEED_MARGIN_PX/);
  assert.match(effect, /window\.addEventListener\("scroll", check, \{ passive: true, capture: true \}\)/);
  assert.match(effect, /\[loadMoreProducts, scrollFeedReady, sentinelNode\]/);
  assert.equal(src.includes("new IntersectionObserver"), false);
  assert.equal(src.includes("loadMoreSentinelRef"), false);
});

test("the feed re-checks once a competing list fetch settles", () => {
  const ready = block(
    "const productsFeedBusy =",
    "\n  useEffect(() => {\n    if (!sentinelNode",
  );
  assert.match(ready, /loading \|\| refreshingProducts \|\| loadingMoreProducts/);
  assert.match(ready, /hasMoreProducts && !loadMoreError && !productsFeedBusy/);
});

test("a failed page offers retry instead of killing the feed", () => {
  const loader = block(
    "const loadMoreProducts = useCallback",
    "\n  // Auto-load the next page",
  );
  const failure = block("    } catch {\n      // A failed page", "    } finally {");
  assert.match(loader, /loadMoreError \|\|\n      !hasMoreProducts/);
  assert.match(failure, /setLoadMoreError\("We could not load more products\."\)/);
  assert.equal(failure.includes("setHasMoreProducts(false)"), false);
});

test("every paged listing mounts the scroll feed", () => {
  const feeds = [...src.matchAll(/<ProductScrollFeed/g)].length;
  const sentinels = [...src.matchAll(/onSentinel=\{setSentinelNode\}/g)].length;
  assert.equal(feeds, 3, "home, explore and the public marketplace all auto-load");
  assert.equal(sentinels, feeds, "each feed passes the shared sentinel setter");
});
