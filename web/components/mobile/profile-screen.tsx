"use client";

import Link from "next/link";
import type { ComponentType, ReactNode } from "react";
import { useRef, useState } from "react";
import { authHeaders, type AuthUser } from "../../lib/auth";
import { MediaNotConfiguredError, uploadImage } from "../../lib/media";
import { ThemeSwitch } from "../theme/theme-switch";
import PhoneVerificationCard from "../verification/phone-verification-card";
import type { MobileView } from "./tab-bar";
import {
  ArrowLeftIcon,
  BasketIcon,
  BellIcon,
  BoxIcon,
  CallIcon,
  CameraIcon,
  CheckIcon,
  ChevronRightIcon,
  CloseIcon,
  HelpIcon,
  InfoIcon,
  ListIcon,
  LogoutIcon,
  MapPinIcon,
  MegaphoneIcon,
  MoonIcon,
  SettingsIcon,
  ShieldIcon,
  SlidersIcon,
  StoreIcon,
  TranslateIcon,
  TruckIcon,
} from "./icons";

type ProfileScreenProps = {
  user: AuthUser;
  orderCount: number;
  cartCount: number;
  notificationsPanel: ReactNode;
  initialScreen?: "overview" | "settings" | "edit-profile";
  onNavigate: (view: MobileView) => void;
  onViewOrders: () => void;
  onSignOut: () => void;
  /** Hands the saved account back so the shell (header greeting etc.) refreshes. */
  onUserUpdated?: (user: AuthUser) => void;
};

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://" + "localhost" + ":3000";

// Toggle switch matching the iOS/modern mobile switch in the reference design
function ToggleSwitch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full p-0.5 transition-colors duration-200 ease-in-out focus:outline-none ${
        checked ? "bg-[#17633a]" : "bg-[#d5ddd3]"
      }`}
    >
      <span
        aria-hidden="true"
        className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-sm ring-0 transition duration-200 ease-in-out ${
          checked ? "translate-x-5" : "translate-x-0"
        }`}
      />
    </button>
  );
}

// Grouped card wrapper matching the reference layout
function GroupCard({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`overflow-hidden rounded-2xl border border-[#dce2d9] bg-white divide-y divide-[#edf1ec] shadow-sm ${className}`}
    >
      {children}
    </div>
  );
}

// Single menu row inside a grouped card
function MenuRowItem({
  Icon,
  label,
  hint,
  accessory,
  href,
  onClick,
  danger,
}: {
  Icon?: ComponentType<{ className?: string }>;
  label: string;
  hint?: string;
  accessory?: ReactNode;
  href?: string;
  onClick?: () => void;
  danger?: boolean;
}) {
  const content = (
    <div className="flex w-full items-center justify-between gap-3 px-4 py-3.5 text-left transition hover:bg-[#fafbf9] active:bg-[#f3f5f1]">
      <div className="flex min-w-0 items-center gap-3">
        {Icon ? (
          <span
            className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ${
              danger
                ? "bg-red-50 text-red-600"
                : "bg-[#eaf3ec] text-[#17633a]"
            }`}
          >
            <Icon className="h-4 w-4" />
          </span>
        ) : null}
        <div className="min-w-0">
          <div
            className={`truncate text-[13px] font-bold ${
              danger ? "text-red-600" : "text-[#17251b]"
            }`}
          >
            {label}
          </div>
          {hint ? (
            <div className="truncate text-[11px] text-[#7c877e]">{hint}</div>
          ) : null}
        </div>
      </div>

      <div className="shrink-0 flex items-center gap-1.5 text-xs text-[#7c877e]">
        {accessory ?? (
          <ChevronRightIcon className="h-4 w-4 text-[#9aa49b]" />
        )}
      </div>
    </div>
  );

  if (href) {
    return (
      <Link href={href} className="block">
        {content}
      </Link>
    );
  }

  return (
    <button type="button" onClick={onClick} className="block w-full">
      {content}
    </button>
  );
}

export default function ProfileScreen({
  user,
  orderCount,
  cartCount,
  notificationsPanel,
  initialScreen = "overview",
  onNavigate,
  onViewOrders,
  onSignOut,
  onUserUpdated,
}: ProfileScreenProps) {
  const [screen, setScreen] = useState<"overview" | "settings" | "edit-profile">(
    initialScreen,
  );

  // Settings toggles
  const [pauseNotifications, setPauseNotifications] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);

  // Profile edit fields
  const [firstName, setFirstName] = useState(user.firstName ?? "");
  const [lastName, setLastName] = useState(user.lastName ?? "");
  const [phone, setPhone] = useState(user.phone ?? "");
  const [avatarUrl, setAvatarUrl] = useState(user.avatarUrl ?? "");
  const [saving, setSaving] = useState(false);
  const [savingPhoto, setSavingPhoto] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [savedMessage, setSavedMessage] = useState(false);
  const photoInputRef = useRef<HTMLInputElement>(null);

  // Modal / panel states
  const [activeModal, setActiveModal] = useState<string | null>(null);

  const initials = `${firstName.charAt(0) ?? ""}${lastName.charAt(0) ?? ""}`.toUpperCase() ||
    user.email.charAt(0).toUpperCase();

  function announceSaved(next: AuthUser) {
    onUserUpdated?.(next);
    setSavedMessage(true);
    setTimeout(() => setSavedMessage(false), 2500);
  }

  // The settings screen's Save button used to only flip the toast — it now
  // PATCHes the account row (name, contact number, display picture).
  const handleSaveProfile = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setSaveError("");

    try {
      const response = await fetch(`${API_BASE_URL}/api/profile/me`, {
        method: "PATCH",
        headers: {
          ...authHeaders(),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          phone: phone.trim() || null,
          avatarUrl: avatarUrl.trim() || null,
        }),
      });

      const data = (await response.json().catch(() => null)) as {
        message?: string | string[];
      } | null;

      if (!response.ok) {
        const message = Array.isArray(data?.message)
          ? data.message.join(", ")
          : data?.message;
        throw new Error(message || "Could not save your profile — try again.");
      }

      announceSaved({
        ...user,
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        phone: phone.trim() || null,
        avatarUrl: avatarUrl.trim() || null,
      });
    } catch (saveError) {
      setSaveError(
        saveError instanceof Error
          ? saveError.message
          : "Could not save your profile — try again.",
      );
    } finally {
      setSaving(false);
    }
  };

  // Camera badge → Cloudinary ("avatar" kind) → the edit form carries the
  // URL into the same PATCH on Save.
  const handlePhotoPick = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setSavingPhoto(true);
    setSaveError("");

    try {
      setAvatarUrl(await uploadImage(file, "avatar"));
    } catch (uploadError) {
      setSaveError(
        uploadError instanceof MediaNotConfiguredError
          ? "Image uploads are not configured on this server."
          : uploadError instanceof Error
            ? uploadError.message
            : "Could not upload that photo — try again.",
      );
    } finally {
      setSavingPhoto(false);
    }
  };

  // -------------------------------------------------------------
  // Screen: EDIT PROFILE (Matches Screen 2 from reference screenshot)
  // -------------------------------------------------------------
  if (screen === "edit-profile") {
    return (
      <div className="mx-auto max-w-2xl space-y-4 px-4 py-3">
        {/* Top Header */}
        <div className="flex items-center justify-between pt-1">
          <button
            type="button"
            onClick={() => setScreen("overview")}
            aria-label="Back"
            className="flex h-10 w-10 items-center justify-center rounded-full border border-[#dce2d9] bg-white text-[#17251b] shadow-sm transition active:scale-95"
          >
            <ArrowLeftIcon className="h-4 w-4" />
          </button>
          <h1 className="text-base font-black tracking-tight text-[#17251b]">
            Edit Profile
          </h1>
          <div className="w-10" />
        </div>

        {/* Hero Avatar with camera badge */}
        <div className="py-2 text-center">
          <div className="relative mx-auto inline-block">
            <div className="flex h-24 w-24 items-center justify-center overflow-hidden rounded-full bg-[#17633a] text-3xl font-black text-white shadow-md ring-4 ring-white">
              {avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={avatarUrl}
                  alt=""
                  className="h-full w-full object-cover"
                />
              ) : (
                initials
              )}
            </div>
            <button
              type="button"
              aria-label="Change photo"
              disabled={savingPhoto}
              onClick={() => photoInputRef.current?.click()}
              className="absolute -bottom-1 -right-1 flex h-8 w-8 items-center justify-center rounded-full border-2 border-white bg-[#17633a] text-white shadow-md transition hover:bg-[#0f4d2b] active:scale-95 disabled:opacity-60"
            >
              <CameraIcon className="h-4 w-4" />
            </button>
            <input
              ref={photoInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/avif"
              onChange={(event) => void handlePhotoPick(event)}
              className="hidden"
              aria-hidden="true"
              tabIndex={-1}
            />
          </div>
          <div className="mt-2 text-xs font-bold text-[#17251b]">
            {firstName} {lastName}
          </div>
          <div className="text-[11px] text-[#7c877e]">{user.email}</div>
        </div>

        {/* Grouped Fields Card */}
        <form onSubmit={handleSaveProfile} className="space-y-4">
          <GroupCard>
            {/* Full name */}
            <div className="flex items-center justify-between gap-3 px-4 py-3.5">
              <label htmlFor="edit-name" className="text-xs font-semibold text-[#69756c]">
                Full name
              </label>
              <div className="flex flex-1 justify-end gap-1.5">
                <input
                  id="edit-name"
                  type="text"
                  value={`${firstName} ${lastName}`.trim()}
                  onChange={(e) => {
                    const parts = e.target.value.split(" ");
                    setFirstName(parts[0] ?? "");
                    setLastName(parts.slice(1).join(" "));
                  }}
                  className="w-full max-w-[200px] text-right text-sm font-bold text-[#17251b] outline-none placeholder:text-[#9aa49b]"
                  placeholder="Your Name"
                />
              </div>
            </div>

            {/* Phone number */}
            <div className="flex items-center justify-between gap-3 px-4 py-3.5">
              <label htmlFor="edit-phone" className="text-xs font-semibold text-[#69756c]">
                Phone number
              </label>
              <input
                id="edit-phone"
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+27 00 000 0000"
                className="w-full max-w-[200px] text-right text-sm font-bold text-[#17251b] outline-none placeholder:text-[#9aa49b]"
              />
            </div>

            {/* Email */}
            <div className="flex items-center justify-between gap-3 px-4 py-3.5">
              <span className="text-xs font-semibold text-[#69756c]">
                Email
              </span>
              <span className="text-right text-sm font-bold text-[#69756c]">
                {user.email}
              </span>
            </div>

            {/* Username / Role */}
            <div className="flex items-center justify-between gap-3 px-4 py-3.5">
              <span className="text-xs font-semibold text-[#69756c]">
                Username
              </span>
              <span className="text-right text-sm font-bold text-[#17633a]">
                @{user.email.split("@")[0]}
              </span>
            </div>
          </GroupCard>

          {/* Feedback Toast */}
          {savedMessage ? (
            <div
              role="status"
              className="flex items-center justify-center gap-1.5 rounded-xl bg-[#eaf3ec] px-4 py-2.5 text-xs font-bold text-[#17633a]"
            >
              <CheckIcon className="h-4 w-4" />
              Changes saved successfully
            </div>
          ) : null}

          {saveError ? (
            <div
              role="alert"
              className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-center text-xs font-bold text-rose-700"
            >
              {saveError}
            </div>
          ) : null}

          {/* Save Changes Button */}
          <button
            type="submit"
            disabled={saving || savingPhoto}
            className="w-full rounded-full bg-[#17633a] py-3.5 text-center text-sm font-black text-white shadow-md transition hover:bg-[#0f4d2b] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {saving ? "Saving..." : "Save Changes"}
          </button>

          {/* Secondary Action */}
          <button
            type="button"
            onClick={onSignOut}
            className="w-full py-2 text-center text-xs font-bold text-[#7c877e] transition hover:text-red-600"
          >
            Delete Account
          </button>
        </form>
      </div>
    );
  }

  // -------------------------------------------------------------
  // Screen: SETTINGS (Matches Screen 1 from reference screenshot)
  // -------------------------------------------------------------
  if (screen === "settings") {
    return (
      <div className="mx-auto max-w-2xl space-y-4 px-4 py-3">
        {/* Top Header */}
        <div className="flex items-center justify-between pt-1">
          <button
            type="button"
            onClick={() => setScreen("overview")}
            aria-label="Back"
            className="flex h-10 w-10 items-center justify-center rounded-full border border-[#dce2d9] bg-white text-[#17251b] shadow-sm transition active:scale-95"
          >
            <ArrowLeftIcon className="h-4 w-4" />
          </button>
          <h1 className="text-base font-black tracking-tight text-[#17251b]">
            Settings
          </h1>
          <div className="w-10" />
        </div>

        {/* User Card (clickable to Edit Profile) */}
        <button
          type="button"
          onClick={() => setScreen("edit-profile")}
          className="flex w-full items-center justify-between gap-3 rounded-2xl border border-[#dce2d9] bg-white p-3.5 text-left shadow-sm transition hover:bg-[#fafbf9] active:scale-[0.99]"
        >
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-full bg-[#17633a] text-base font-black text-white shadow-sm">
              {avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={avatarUrl}
                  alt=""
                  className="h-full w-full object-cover"
                />
              ) : (
                initials
              )}
            </div>
            <div className="min-w-0">
              <div className="truncate text-sm font-black text-[#17251b]">
                {firstName} {lastName}
              </div>
              <div className="truncate text-xs text-[#7c877e]">
                @{user.email.split("@")[0]}
              </div>
            </div>
          </div>
          <ChevronRightIcon className="h-4 w-4 text-[#9aa49b]" />
        </button>

        {/* CP17: phone verification — the checkout gate lives here. */}
        <PhoneVerificationCard />

        {/* Group 1: Notifications & General Settings */}
        <GroupCard>
          <div className="flex w-full items-center justify-between gap-3 px-4 py-3.5">
            <div className="flex items-center gap-3">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-[#eaf3ec] text-[#17633a]">
                <BellIcon className="h-4 w-4" />
              </span>
              <span className="text-[13px] font-bold text-[#17251b]">
                Pause notifications
              </span>
            </div>
            <ToggleSwitch
              checked={pauseNotifications}
              onChange={setPauseNotifications}
              label="Pause notifications"
            />
          </div>

          <MenuRowItem
            Icon={SlidersIcon}
            label="General settings"
            onClick={() => setActiveModal("general")}
          />
        </GroupCard>

        {/* Group 2: Display, Language & Contact */}
        <GroupCard>
          <div className="flex w-full flex-wrap items-center justify-between gap-3 px-4 py-3.5">
            <div className="flex items-center gap-3">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-[#eaf3ec] text-[#17633a]">
                <MoonIcon className="h-4 w-4" />
              </span>
              <div>
                <span className="block text-[13px] font-bold text-[#17251b]">
                  Appearance
                </span>
                <span className="mt-0.5 block text-[11px] leading-4 text-[#7c877e]">
                  Choose how Bonagri looks on your device.
                </span>
              </div>
            </div>
            <ThemeSwitch />
          </div>

          <MenuRowItem
            Icon={TranslateIcon}
            label="Language"
            accessory={
              <span className="flex items-center gap-1 text-xs text-[#7c877e]">
                English (ZA)
                <ChevronRightIcon className="h-4 w-4 text-[#9aa49b]" />
              </span>
            }
            onClick={() => setActiveModal("language")}
          />

          <MenuRowItem
            Icon={CallIcon}
            label="My Contact"
            onClick={() => setActiveModal("contact")}
          />
        </GroupCard>

        {/* Group 3: Help, Terms, Policies */}
        <GroupCard>
          <MenuRowItem
            Icon={HelpIcon}
            label="FAQ"
            onClick={() => setActiveModal("faq")}
          />
          <MenuRowItem
            Icon={InfoIcon}
            label="Terms of service"
            onClick={() => setActiveModal("terms")}
          />
          <MenuRowItem
            Icon={ShieldIcon}
            label="User policy"
            onClick={() => setActiveModal("policy")}
          />
        </GroupCard>

        {/* Bottom Standalone Log Out Button */}
        <button
          type="button"
          onClick={onSignOut}
          className="flex w-full items-center justify-center gap-2 rounded-2xl border border-red-200 bg-white py-3.5 text-center text-sm font-black text-red-600 shadow-sm transition hover:bg-red-50 active:scale-[0.99] md:rounded-full"
        >
          <LogoutIcon className="h-4 w-4 text-red-600" />
          <span>Log Out</span>
        </button>

        {/* Modals for Settings details */}
        {activeModal ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-xs">
            <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl">
              <div className="flex items-center justify-between pb-3">
                <h2 className="text-base font-black capitalize text-[#17251b]">
                  {activeModal === "faq"
                    ? "FAQ"
                    : activeModal === "terms"
                    ? "Terms of service"
                    : activeModal === "policy"
                    ? "User policy"
                    : activeModal === "language"
                    ? "Language"
                    : activeModal === "contact"
                    ? "Contact Support"
                    : "General Settings"}
                </h2>
                <button
                  type="button"
                  onClick={() => setActiveModal(null)}
                  className="rounded-full p-1 text-[#7c877e] hover:bg-[#f4f6f1]"
                >
                  <CloseIcon className="h-4 w-4" />
                </button>
              </div>

              <div className="py-2 text-xs leading-5 text-[#5e6b61]">
                {activeModal === "faq" ? (
                  <div className="space-y-2">
                    <p className="font-bold text-[#17251b]">How does BonAgri order escrow work?</p>
                    <p>Payments are safely reserved until your order arrives and is verified.</p>
                    <p className="font-bold text-[#17251b] pt-1">Who delivers my order?</p>
                    <p>Verified regional transporters in Limpopo handle delivery directly to your designated address.</p>
                  </div>
                ) : activeModal === "terms" ? (
                  <p>
                    By using BonAgri, buyers and suppliers agree to fair trade, genuine agricultural produce descriptions, and prompt delivery handshakes.
                  </p>
                ) : activeModal === "policy" ? (
                  <p>
                    Your privacy and data are protected under South African POPIA regulations. We never sell your personal information.
                  </p>
                ) : activeModal === "language" ? (
                  <div className="space-y-1">
                    <div className="flex items-center justify-between rounded-xl bg-[#eaf3ec] px-3 py-2 font-bold text-[#17633a]">
                      <span>English (South Africa)</span>
                      <CheckIcon className="h-4 w-4" />
                    </div>
                    <div className="px-3 py-2 text-[#7c877e]">Sepedi / Northern Sotho (Coming soon)</div>
                    <div className="px-3 py-2 text-[#7c877e]">Tshivenda (Coming soon)</div>
                    <div className="px-3 py-2 text-[#7c877e]">Xitsonga (Coming soon)</div>
                  </div>
                ) : activeModal === "contact" ? (
                  <div className="space-y-2">
                    <p>Need assistance with your agricultural orders or supply listings?</p>
                    <p className="font-bold text-[#17633a]">support@bonagri.co.za</p>
                    <p className="font-bold text-[#17633a]">+27 (0)15 291 0000</p>
                  </div>
                ) : (
                  <p>
                    Configure notification alerts, auto-checkout preferences, and regional supply discovery radius.
                  </p>
                )}
              </div>

              <button
                type="button"
                onClick={() => setActiveModal(null)}
                className="mt-4 w-full rounded-xl bg-[#17633a] py-2.5 text-center text-xs font-bold text-white hover:bg-[#0f4d2b]"
              >
                Done
              </button>
            </div>
          </div>
        ) : null}
      </div>
    );
  }

  // -------------------------------------------------------------
  // Screen: PROFILE OVERVIEW (Main Profile Tab matching reference layout)
  // -------------------------------------------------------------
  return (
    <div className="mx-auto max-w-2xl space-y-4 px-4 py-3">
      {/* Top Header */}
      <div className="flex items-center justify-between pt-1">
        <h1 className="text-xl font-black tracking-tight text-[#17251b]">
          Profile
        </h1>
        <button
          type="button"
          onClick={() => setScreen("settings")}
          aria-label="Settings"
          className="flex h-9 w-9 items-center justify-center rounded-full border border-[#dce2d9] bg-white text-[#17251b] shadow-sm transition hover:bg-[#f4f6f1] active:scale-95"
        >
          <SettingsIcon className="h-4 w-4 text-[#17251b]" />
        </button>
      </div>

      {/* Profile Card (Top User Card matching Screenshot Screen 1) */}
      <button
        type="button"
        onClick={() => setScreen("edit-profile")}
        className="flex w-full items-center justify-between gap-3.5 rounded-2xl border border-[#dce2d9] bg-white p-3.5 text-left shadow-sm transition hover:bg-[#fafbf9] active:scale-[0.99]"
      >
        <div className="flex items-center gap-3">
          <div className="flex h-13 w-13 shrink-0 items-center justify-center overflow-hidden rounded-full bg-[#17633a] text-lg font-black text-white shadow-sm">
            {avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={avatarUrl}
                alt=""
                className="h-full w-full object-cover"
              />
            ) : (
              initials
            )}
          </div>

          <div className="min-w-0">
            <div className="truncate text-sm font-black text-[#17251b]">
              {firstName} {lastName}
            </div>
            <div className="truncate text-xs text-[#7c877e]">
              @{user.email.split("@")[0]}
            </div>
            <div className="mt-1 inline-flex items-center rounded-full bg-[#eaf3ec] px-2 py-0.5 text-[9px] font-black uppercase tracking-wide text-[#17633a]">
              {user.role.toLowerCase()}
            </div>
          </div>
        </div>

        <ChevronRightIcon className="h-4 w-4 text-[#9aa49b]" />
      </button>

      {/* Group 1: Commerce & Orders (Grouped Card) */}
      <GroupCard>
        <MenuRowItem
          Icon={ListIcon}
          label="My orders"
          hint="Track your agricultural purchases & status"
          accessory={
            <span className="flex items-center gap-1.5 font-bold text-[#17633a]">
              <span className="rounded-full bg-[#eaf3ec] px-2 py-0.5 text-[10px] font-black">
                {orderCount}
              </span>
              <ChevronRightIcon className="h-4 w-4 text-[#9aa49b]" />
            </span>
          }
          onClick={onViewOrders}
        />

        <MenuRowItem
          Icon={BasketIcon}
          label="In cart"
          hint="Produce ready for checkout"
          accessory={
            <span className="flex items-center gap-1.5 font-bold text-[#17633a]">
              <span className="rounded-full bg-[#eaf3ec] px-2 py-0.5 text-[10px] font-black">
                {cartCount}
              </span>
              <ChevronRightIcon className="h-4 w-4 text-[#9aa49b]" />
            </span>
          }
          onClick={() => onNavigate("cart")}
        />

        <MenuRowItem
          Icon={MapPinIcon}
          label="Delivery addresses"
          hint="Where your orders get delivered"
          href="/addresses"
        />

        {user.role === "BUYER" ? (
          <MenuRowItem
            Icon={MegaphoneIcon}
            label="Product requests"
            hint="Post what you need and get supplier responses"
            href="/requests"
          />
        ) : null}
      </GroupCard>

      {/* Group 2: Preferences & Settings (Grouped Card) */}
      <GroupCard>
        <MenuRowItem
          Icon={SettingsIcon}
          label="Settings"
          hint="Notifications, display, language & support"
          onClick={() => setScreen("settings")}
        />

        <div>
          <div className="flex w-full items-center justify-between gap-3 px-4 py-3.5">
            <button
              type="button"
              onClick={() => setShowNotifications((open) => !open)}
              className="flex flex-1 items-center gap-3 text-left transition hover:opacity-90"
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-[#eaf3ec] text-[#17633a]">
                <BellIcon className="h-4 w-4" />
              </span>
              <div>
                <span className="block text-[13px] font-bold text-[#17251b]">
                  Notifications
                </span>
                <span className="block text-[11px] text-[#7c877e]">
                  {showNotifications ? "Tap to close notifications" : "Order updates and account activity"}
                </span>
              </div>
            </button>
            <ToggleSwitch
              checked={!pauseNotifications}
              onChange={(active) => setPauseNotifications(!active)}
              label="Toggle notifications"
            />
          </div>

          {showNotifications ? (
            <div className="border-t border-[#edf1ec] bg-[#fafbf9] p-3">
              {notificationsPanel}
            </div>
          ) : null}
        </div>
      </GroupCard>

      {/* Group 3: Selling & Consoles (if applicable) */}
      <GroupCard>
        <MenuRowItem
          Icon={StoreIcon}
          label="Sell on BonAgri"
          hint="Apply to become an agricultural supplier"
          href="/apply"
        />

        {user.role === "SUPPLIER" || user.role === "AGRO_DEALER" ? (
          <MenuRowItem
            Icon={BoxIcon}
            label="Supplier console"
            hint="Inventory, listings and orders"
            href="/supplier"
          />
        ) : null}

        {user.role === "TRANSPORTER" ? (
          <MenuRowItem
            Icon={TruckIcon}
            label="Transport hub"
            hint="Claim and manage delivery jobs"
            href="/transport"
          />
        ) : null}

        {user.role === "ADMIN" ? (
          <MenuRowItem
            Icon={ShieldIcon}
            label="Admin console"
            hint="Users, orders, disputes and more"
            href="/admin"
          />
        ) : null}
      </GroupCard>

      {/* Group 4: Support & Legal */}
      <GroupCard>
        <MenuRowItem
          Icon={HelpIcon}
          label="FAQ"
          onClick={() => {
            setScreen("settings");
            setActiveModal("faq");
          }}
        />
        <MenuRowItem
          Icon={InfoIcon}
          label="Terms of service"
          onClick={() => {
            setScreen("settings");
            setActiveModal("terms");
          }}
        />
        <MenuRowItem
          Icon={ShieldIcon}
          label="User policy"
          onClick={() => {
            setScreen("settings");
            setActiveModal("policy");
          }}
        />
      </GroupCard>

      {/* Bottom Standalone Log Out Button (Matching red pill in screenshot) */}
      <button
        type="button"
        onClick={onSignOut}
        className="flex w-full items-center justify-center gap-2 rounded-2xl border border-red-200 bg-white py-3.5 text-center text-sm font-black text-red-600 shadow-sm transition hover:bg-red-50 active:scale-[0.99] md:rounded-full"
      >
        <LogoutIcon className="h-4 w-4 text-red-600" />
        <span>Log Out</span>
      </button>

      <p className="pb-2 text-center text-[10px] font-semibold uppercase tracking-wide text-[#9aa49b]">
        BonAgri · Limpopo, South Africa
      </p>
    </div>
  );
}
