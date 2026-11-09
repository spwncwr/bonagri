import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (relative) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

const accountCard = read("../components/settings/account-settings.tsx");
const supplierSettings = read("../app/supplier/settings/page.tsx");
const transporterSettings = read("../components/transport/transporter-settings.tsx");
const transportPage = read("../app/transport/page.tsx");
const supplierShell = read("../components/supplier/supplier-shell.tsx");
const profileScreen = read("../components/mobile/profile-screen.tsx");
const homeShell = read("../components/marketplace/home-shell.tsx");
const settingsPage = read("../app/settings/page.tsx");
const profilePage = read("../app/profile/page.tsx");
const mediaLib = read("../lib/media.ts");
const authLib = read("../lib/auth.ts");

test("the buyer-only routes keep their guard while vendors get their own screens", () => {
  // /settings and /profile stay buyer territory...
  assert.match(settingsPage, /allowedRoles={\["BUYER"\]}/);
  assert.match(profilePage, /allowedRoles={\["BUYER"\]}/);

  // ...and the supplier/agro-dealer desk answers with its own settings
  // screen instead of the two dead /settings links it used to carry.
  assert.match(supplierShell, /href="\/supplier\/settings"/);
  assert.doesNotMatch(supplierShell, /href="\/settings"/);
  assert.match(supplierSettings, /AccountSettings/);
  assert.match(
    supplierSettings,
    /PATCH|method: "PATCH"/,
    "the storefront form must actually save",
  );
});

test("the phone More sheet offers a settings entry", () => {
  assert.match(supplierShell, /const SHEET_ITEMS: NavItem\[\]/);
  assert.match(
    supplierShell,
    /label: "Settings", icon: SettingsIcon, href: "\/supplier\/settings"/,
  );
  assert.match(supplierShell, /\[\.\.\.NAV, \.\.\.SHEET_ITEMS\]/);
});

test("the shared account card persists through PATCH /api/profile/me", () => {
  assert.match(accountCard, /\/api\/profile\/me/);
  assert.match(accountCard, /method: "PATCH"/);
  // avatar, names and contact all go up together
  assert.match(accountCard, /firstName: firstName\.trim\(\)/);
  assert.match(accountCard, /lastName: lastName\.trim\(\)/);
  assert.match(accountCard, /phone: phone\.trim\(\) \|\| null/);
  assert.match(accountCard, /avatarUrl: avatarUrl\.trim\(\) \|\| null/);
  // the sign-in address stays read-only — changing it needs re-verification
  assert.match(accountCard, /value=\{user\.email\}\s*\n\s*readOnly/);
  // every editable field is labelled through the prefix (the transport tab
  // renders this card twice, so bare ids would collide)
  assert.match(accountCard, /idPrefix \?\? |idPrefix = /);
  assert.match(accountCard, /id=\{`\$\{idPrefix\}-first-name`\}/);
});

test("every role's settings screen is reachable and saves its own domain", () => {
  // supplier / agro-dealer → storefront
  assert.match(supplierSettings, /\/api\/supplier\/profile/);
  assert.match(supplierSettings, /businessName/);
  assert.match(supplierSettings, /kind="supplier_logo"/);

  // transporter → transport details (wired into both tab branches)
  assert.match(transporterSettings, /\/api\/transport\/profile/);
  assert.match(transporterSettings, /serviceProvinces/);
  assert.match(transporterSettings, /PROVINCES/);
  assert.match(transportPage, /<TransporterSettings idPrefix="tp" \/>/);
  assert.match(transportPage, /<TransporterSettings idPrefix="tp-desk" \/>/);
  // a pending transporter must still be able to fill in what verification
  // looks at, so the settings section survives the unverified desk gate
  assert.match(transportPage, /idPrefix="tp-desk-pending"/);
});

test("the avatar upload kind exists on both sides of the wire", () => {
  assert.match(mediaLib, /\| "avatar"/);
  // buyer's edit screen uploads it directly
  assert.match(profileScreen, /uploadImage\(file, "avatar"\)/);
  assert.match(profileScreen, /photoInputRef\.current\?\.click\(\)/);
  assert.match(profileScreen, /accept="image\/jpeg/);
});

test("the buyer's Save Changes calls the API instead of only toasting", () => {
  assert.match(profileScreen, /\/api\/profile\/me/);
  assert.match(profileScreen, /method: "PATCH"/);
  // success hands the saved account back to the shell so the header
  // greeting and avatar refresh immediately
  assert.match(profileScreen, /onUserUpdated\?\.\(next\)/);
  assert.match(homeShell, /onUserUpdated=\{setCurrentUser\}/);
  // and failures surface instead of pretending it saved
  assert.match(profileScreen, /role="alert"/);
  assert.match(profileScreen, /saveError/);
  // the hero photo renders the stored avatar when there is one
  assert.match(profileScreen, /<img\s+src=\{avatarUrl\}/);
});

test("the account types carry the avatar and role profiles the screens need", () => {
  assert.match(authLib, /avatarUrl: string \| null/);
  assert.match(authLib, /supplierProfile\?: SupplierAccount \| null/);
  assert.match(authLib, /transporterProfile\?: TransporterAccount \| null/);
  assert.match(authLib, /serviceProvinces: string\[\]/);
});
