import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (relative) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

const thread = read("../components/messages/order-thread.tsx");
const unreads = read("../components/messages/use-message-unreads.ts");
const buyerDetail = read("../app/orders/[id]/page.tsx");
const supplierOrders = read("../app/supplier/orders/page.tsx");
const transport = read("../app/transport/page.tsx");

// F2 (plan §6): one polling-only, text-only thread per order — buyer with
// the supplier and the assigned transporter, admin read-only, unread badge
// fed in bulk. WebSocket, media and read receipts are explicitly out.

test("the thread polls on a timer and speaks only the three F2 routes", () => {
  assert.match(thread, /const POLL_MS = 4000/);
  // no realtime transport code — polling is the whole delivery mechanism
  assert.doesNotMatch(thread, /new WebSocket|new EventSource|socket\.io/);
  // text-only: one bounded plain-text body, no attachments
  assert.match(thread, /type="text"/);
  assert.match(thread, /maxLength=\{2000\}/);
  assert.doesNotMatch(thread, /type="file"|FormData/);
  // the exact API surface
  assert.match(thread, /\/api\/orders\/\$\{orderId\}\/messages\b/);
  assert.match(thread, /\/api\/orders\/\$\{orderId\}\/messages\/read/);
  // an open thread clears its own unread cursor
  assert.match(thread, /next\.unreadCount > 0/);
  assert.match(thread, /method: "POST"/);
  // the poll interval is torn down on close/unmount
  assert.match(thread, /return \(\) => clearInterval\(timer\)/);
});

test("send waits for a non-empty trimmed body and reports failures inline", () => {
  assert.match(thread, /const body = draft\.trim\(\)/);
  assert.match(thread, /if \(!body \|\| sending\) return/);
  assert.match(thread, /disabled=\{sending \|\| draft\.trim\(\).length === 0\}/);
  // 403 = admin tried to post to a read-only thread
  assert.match(thread, /response\.status === 403/);
  assert.match(thread, /Admins have read-only access/);
});

test("admin sees a read-only notice instead of the composer", () => {
  assert.match(thread, /thread\?\.readOnly \?/);
  assert.match(thread, /Admin view/);
  assert.match(thread, /you can read this conversation, but not post to it/);
});

test("the bulk badge feed is one request for every visible card", () => {
  assert.match(unreads, /\/api\/messages\/unread/);
  assert.match(unreads, /const REFRESH_MS = 30000/);
  assert.match(unreads, /return \(\) => \{[\s\S]*clearInterval\(timer\)/);
  // silent degradation — badges just refresh next tick
  assert.match(unreads, /Silent: badges simply refresh on the next tick/);
});

test("the buyer order detail carries an always-available thread", () => {
  assert.match(buyerDetail, /import \{ OrderThread \}/);
  assert.match(buyerDetail, /<OrderThread orderId=\{order\.id\} defaultOpen \/>/);
  // it sits in its own Messages section, not bolted onto another card
  assert.match(
    buyerDetail,
    /Messages[\s\S]{0,200}<OrderThread orderId=\{order\.id\} defaultOpen/,
  );
});

test("the supplier order cards thread with the bulk unread badge", () => {
  assert.match(supplierOrders, /import \{ OrderThread \}/);
  assert.match(supplierOrders, /import \{ useMessageUnreads \}/);
  assert.match(supplierOrders, /const unreadMessages = useMessageUnreads\(\)/);
  assert.match(
    supplierOrders,
    /<OrderThread\s*\n?\s*orderId=\{order\.id\}\s*\n?\s*unread=\{unreadMessages\[order\.id\] \?\? 0\}/,
  );
});

test("the transporter detail sheet threads with the same badge feed", () => {
  assert.match(transport, /import \{ OrderThread \}/);
  assert.match(transport, /import \{ useMessageUnreads \}/);
  assert.match(transport, /const unreadMessages = useMessageUnreads\(\)/);
  // DetailSheet takes the count for the open delivery
  assert.match(transport, /unread\?: number/);
  assert.match(
    transport,
    /unread=\{unreadMessages\[selectedDelivery\.orderId\] \?\? 0\}/,
  );
  assert.match(
    transport,
    /<OrderThread\s*\n?\s*orderId=\{delivery\.orderId\}\s*\n?\s*unread=\{unread\}/,
  );
  // the dark sheet scrolls so the open thread stays reachable
  assert.match(transport, /max-h-\[92vh\][^"]*overflow-y-auto/);
});
