"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { useRouter } from "next/navigation";
import NotificationsPanel from "../notifications/notifications-panel";
import SignInSheet from "../auth/sign-in-sheet";
import { BrandIcon, BrandLogo } from "../brand/logo";
import GuestWalkthrough from "../onboarding/guest-walkthrough";
import FilterSheet, {
  countActiveFilters,
  DEFAULT_FILTERS,
  FilterChips,
  type MarketplaceFilters,
  type ProductFacets,
} from "./filter-sheet";
import MarketplaceSearch from "./marketplace-search";
import ProductRail from "./product-rail";
import {
  MoreProductsSkeleton,
  ProductGridSkeleton,
} from "./skeletons";
import { authHeaders, fetchCurrentUser, clearAuth, type AuthUser } from "../../lib/auth";
import {
  mapApiProduct,
  type ApiProduct,
  type Product,
} from "../../lib/catalog";
import { buildImageUrl } from "../../lib/media";
import AppHeader from "../mobile/app-header";
import BuyerSidebar from "./buyer-sidebar";
import CartDrawer from "../cart/cart-drawer";
import CartScreen from "../mobile/cart-screen";
import { getCategoryIcon } from "../mobile/category-icons";
import CategoryRow from "../mobile/category-row";
import ProductCard from "../mobile/product-card";
import ProfileScreen from "../mobile/profile-screen";
import PromoCarousel from "../mobile/promo-carousel";
import PromotionFeed from "../promotions/promotion-feed";
import { ArrowLeftIcon, ArrowRightIcon, BellIcon, CheckIcon, MenuIcon, SearchIcon, StarIcon } from "../mobile/icons";
import RatingStarsGlyphs from "../mobile/rating-stars";
import TabBar from "../mobile/tab-bar";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://" + "localhost" + ":3000";

type CartItem = {
  id: string;
  quantity: number;
  lineTotal: number;
  availableQuantity: number;
  inStock: boolean;
  product: {
    id: string;
    name: string;
    unit: string;
    price: string;
    supplierName: string;
  };
};

// CP17: public review payload (buyer names are masked server-side).
type ProductReviewItem = {
  id: string;
  rating: number;
  comment: string | null;
  createdAt: string;
  buyerName: string;
};

type Address = {
  id: string;
  label: string;
  recipientName: string;
  phone: string | null;
  addressLine1: string;
  addressLine2: string | null;
  city: string;
  province: string | null;
  postalCode: string | null;
  country: string;
  isDefault: boolean;
  lat: number | null;
  lng: number | null;
};

type PublicProductRequest = {
  id: string;
  title: string;
  quantity: number;
  unit: string;
  destinationCity: string | null;
  requiredBy: string | null;
  createdAt: string;
  category: { name: string; slug: string } | null;
  _count?: { responses: number };
};

// Category-group segments so tool/equipment listings surface properly (CP4).
const SEGMENT_CATEGORIES: Record<"Produce" | "Tools", string[]> = {
  Produce: [
    "Fresh Produce",
    "Fruits",
    "Vegetables",
    "Chilli & Sauces",
    "Processed Foods",
    "Poultry & Livestock",
  ],
  Tools: [
    "Farm Inputs",
    "Agricultural Tools & Equipment",
    "Seeds & Chemicals",
  ],
};

// Explore-categories cards derive from the same segment universe as the
// marketplace chips (CP8) so a card click always maps to a working filter.
const CATEGORY_DESCRIPTIONS: Record<string, string> = {
  "Fresh Produce": "Produce available from regional suppliers.",
  Fruits: "Fresh fruit from agricultural producers.",
  Vegetables: "Source vegetables by quantity and location.",
  "Chilli & Sauces": "Fresh and processed chilli products.",
  "Processed Foods": "Value-added agricultural products.",
  "Poultry & Livestock": "Eggs, poultry and livestock products.",
  "Farm Inputs": "Inputs and supplies for agricultural production.",
  "Seeds & Chemicals": "Certified seed, fertilisers and crop protection.",
  "Agricultural Tools & Equipment": "Tools, equipment and machinery for the farm.",
};

const CATEGORY_CARDS: Array<[string, string]> = [
  ...SEGMENT_CATEGORIES.Produce.map(
    (name) => [name, CATEGORY_DESCRIPTIONS[name]] as [string, string],
  ),
  ...SEGMENT_CATEGORIES.Tools.map(
    (name) => [name, CATEGORY_DESCRIPTIONS[name]] as [string, string],
  ),
];

// Explicit pill-name -> API slug map (slugifying names would break
// "Agricultural Tools & Equipment" -> "agricultural-tools-equipment").
const CATEGORY_SLUGS: Record<string, string> = {
  "Fresh Produce": "fresh-produce",
  Fruits: "fruits",
  Vegetables: "vegetables",
  "Chilli & Sauces": "chilli-sauces",
  "Processed Foods": "processed-foods",
  "Farm Inputs": "farm-inputs",
  "Agricultural Tools & Equipment": "agricultural-tools",
  "Seeds & Chemicals": "seeds-chemicals",
  "Poultry & Livestock": "poultry-livestock",
};

// /explore?cat= accepts either the display name or the API slug; the filter
// state works with names, so normalise on the way in.
function resolveCategoryName(raw: string): string | null {
  if (!raw) return null;

  if (CATEGORY_SLUGS[raw]) return raw;

  return (
    Object.keys(CATEGORY_SLUGS).find((name) => CATEGORY_SLUGS[name] === raw) ??
    null
  );
}

const workflow = [
  ["01", "Discover", "Search available agricultural products and suppliers."],
  ["02", "Connect", "Engage with suppliers and submit requirements."],
  ["03", "Trade", "Confirm quantities, prices and orders."],
  ["04", "Move", "Coordinate delivery from supplier to buyer."],
];

// CP17: real rating summary — never shows placeholder stars for a product
// with no reviews yet.
function RatingStars({
  average,
  count,
}: {
  average: number | null;
  count: number;
}) {
  if (!count || average === null) {
    return (
      <span className="text-[11px] font-semibold text-[#8a948b]">
        No reviews yet
      </span>
    );
  }

  return (
    <span className="flex items-center gap-1.5 text-[11px]">
      <RatingStarsGlyphs value={average} />
      <span className="font-black text-[#27382b]">{average.toFixed(1)}</span>
      <span className="font-semibold text-[#8a948b]">({count})</span>
    </span>
  );
}

/* How far ahead of the viewport edge the scroll feed fetches the next page. */
const SCROLL_FEED_MARGIN_PX = 600;

/*
 * Tail of a paged listing: the sentinel that pulls the next page in as the
 * buyer scrolls, the skeleton while it is in flight, and a retry only when a
 * page actually fails. No manual "load more" tap on the happy path.
 */
function ProductScrollFeed({
  hasMore,
  loading,
  error,
  onRetry,
  onSentinel,
}: {
  hasMore: boolean;
  loading: boolean;
  error: string;
  onRetry: () => void;
  onSentinel: (node: HTMLDivElement | null) => void;
}) {
  return (
    <>
      {loading ? <MoreProductsSkeleton count={3} /> : null}
      {error ? (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#ccd5ca] bg-white px-4 py-3">
          <p className="text-xs font-bold text-[#69756c]">{error}</p>
          <button
            type="button"
            onClick={onRetry}
            className="rounded-lg border border-[#ccd5ca] bg-white px-3 py-1.5 text-xs font-black text-[#243229] hover:bg-[#f2f4ef]"
          >
            Retry
          </button>
        </div>
      ) : null}
      {hasMore && !error ? (
        <div ref={onSentinel} aria-hidden="true" className="h-px w-full" />
      ) : null}
      <p role="status" aria-live="polite" className="sr-only">
        {loading ? "Loading more products" : ""}
      </p>
    </>
  );
}

function formatOrderDate(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  const timeStr = date.toLocaleTimeString("en-ZA", {
    hour: "2-digit",
    minute: "2-digit",
  });
  if (isToday) {
    return `Today, ${timeStr}`;
  }
  return (
    date.toLocaleDateString("en-ZA", {
      day: "2-digit",
      month: "short",
      year: date.getFullYear() !== now.getFullYear() ? "numeric" : undefined,
    }) + `, ${timeStr}`
  );
}

function getOrderStatusStyle(status: string): {
  label: string;
  colorClass: string;
} {
  switch (status) {
    case "DELIVERED":
      return { label: "Delivered", colorClass: "text-[#17633a]" };
    case "CANCELLED":
      return { label: "Cancelled", colorClass: "text-red-600" };
    case "PENDING":
      return { label: "Pending", colorClass: "text-amber-600" };
    case "CONFIRMED":
      return { label: "Confirmed", colorClass: "text-[#17633a]" };
    case "PROCESSING":
      return { label: "Processing", colorClass: "text-sky-700" };
    case "READY_FOR_DELIVERY":
      return { label: "Ready for delivery", colorClass: "text-indigo-700" };
    case "OUT_FOR_DELIVERY":
      return { label: "Out for delivery", colorClass: "text-indigo-700" };
    default:
      return {
        label: status.replaceAll("_", " "),
        colorClass: "text-[#17633a]",
      };
  }
}

// The mobile shell has four tabs. Each tab is also a real route, so a refresh
// or shared link lands on the same screen the tab bar shows.
type ViewName = "home" | "explore" | "cart" | "profile" | "orders";

const VIEW_PATHS: Record<ViewName, string> = {
  home: "/",
  explore: "/explore",
  cart: "/cart",
  profile: "/profile",
  orders: "/orders",
};

// The marketplace footer, shared by both placements: guests keep it at the
// end of the page (after the marketing close-out) while signed-in buyers get
// it at the end of the shell content — inside the scrollable desktop column,
// where it used to sit at the end of the page.
function SiteFooter({
  view,
  selectedProduct,
  role,
}: {
  view: ViewName;
  selectedProduct: Product | null;
  role?: AuthUser["role"];
}) {
  if (selectedProduct) return null;

  // The cart screen keeps just a centered wordmark.
  if (view === "cart") {
    return (
      <footer className="border-t border-[#dfe4dc] bg-[#f0f1ec]">
        <div className="flex justify-center py-8">
          <BrandLogo height={28} />
        </div>
      </footer>
    );
  }

  return (
    <footer className="border-t border-[#dfe4dc] bg-[#f0f1ec]">
      <div className="mx-auto max-w-7xl px-6 py-10">
        <div className="flex flex-col justify-between gap-8 md:flex-row">
          <div>
            <BrandLogo height={32} />

            <p className="mt-4 max-w-sm text-sm leading-6 text-[#707a71]">
              Agricultural trade, connected — from producers and suppliers to
              buyers and markets.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-x-10 gap-y-2 text-sm font-semibold text-[#4d5a50] sm:grid-cols-3">
            <a href="#marketplace" className="hover:text-[#17633a]">
              Marketplace
            </a>
            {role === "BUYER" && view === "home" ? (
              <a href="#requests" className="hover:text-[#17633a]">
                Product Requests
              </a>
            ) : null}
            <a href="#how-it-works" className="hover:text-[#17633a]">
              How it works
            </a>
            <Link href="/apply" className="hover:text-[#17633a]">
              Sell on BonAgri
            </Link>
            <Link href="/login" className="hover:text-[#17633a]">
              Sign in
            </Link>
          </div>

          <div className="text-sm text-[#69746b]">
            <div className="font-black text-[#344238]">
              Limpopo — A Home of Agriculture
            </div>
            <div className="mt-2">South Africa • Regional agricultural trade</div>
          </div>
        </div>

        <div className="mt-10 border-t border-[#d8ddd5] pt-6 text-xs text-[#7b857c]">
          © 2026 BonAgri. All rights reserved.
        </div>
      </div>
    </footer>
  );
}

export default function HomeShell({
  initialView = "home",
  initialCategory = "",
  initialProductId = "",
  initialProfileScreen = "overview",
}: {
  initialView?: ViewName;
  initialCategory?: string;
  initialProductId?: string;
  initialProfileScreen?: "overview" | "settings" | "edit-profile";
} = {}) {
  const router = useRouter();
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState(
    () => resolveCategoryName(initialCategory) ?? (initialCategory || "All"),
  );
  const [activeSegment, setActiveSegment] = useState<
    "All" | "Produce" | "Tools"
  >("All");
  // One source of truth for the filter sheet + chips + API query.
  const [filters, setFilters] = useState<MarketplaceFilters>(() => ({
    ...DEFAULT_FILTERS,
    category: resolveCategoryName(initialCategory) ?? (initialCategory || "All"),
  }));
  const [facets, setFacets] = useState<ProductFacets | null>(null);
  const [categoryOptions, setCategoryOptions] = useState<
    Array<{ name: string; slug: string }>
  >([]);
  const [filterSheetOpen, setFilterSheetOpen] = useState(false);
  // Typing stays instant; the listing/suggestion read waits for a pause.
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [refreshingProducts, setRefreshingProducts] = useState(false);
  const [productsNonce, setProductsNonce] = useState(0);
  const loadedProductsOnce = useRef(false);
  // Paged catalog reads: only the current view's products are fetched, and
  // more pages stream in as the buyer scrolls.
  const PRODUCTS_PAGE_SIZE = 12;
  const [productPage, setProductPage] = useState(0);
  const [hasMoreProducts, setHasMoreProducts] = useState(false);
  const [loadingMoreProducts, setLoadingMoreProducts] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState("");
  const [sentinelNode, setSentinelNode] = useState<HTMLDivElement | null>(null);
  const [categoryImages, setCategoryImages] = useState<
    Record<string, string | null>
  >({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [orderQuantity, setOrderQuantity] = useState(1);
  const [ordering, setOrdering] = useState(false);
  const [orderError, setOrderError] = useState("");
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [selectedAddressId, setSelectedAddressId] = useState("");
  const [addressesLoading, setAddressesLoading] = useState(false);
  const [addressError, setAddressError] = useState("");
  const [showAddressForm, setShowAddressForm] = useState(false);
  const [savingAddress, setSavingAddress] = useState(false);
  const [productRequests, setProductRequests] = useState<
    PublicProductRequest[]
  >([]);
  const [addressForm, setAddressForm] = useState({
    label: "Home",
    recipientName: "",
    phone: "",
    addressLine1: "",
    addressLine2: "",
    city: "",
    province: "",
    postalCode: "",
    country: "South Africa",
  });
  const [orderSuccess, setOrderSuccess] = useState<{
    orderNumber: string;
    productName: string;
    quantity: number;
    total: string;
    location: string;
    status: string;
  } | null>(null);
  const [orders, setOrders] = useState<
    Array<{
      id: string;
      orderNumber: string;
      orderGroupId?: string | null;
      status: string;
      total: string;
      createdAt: string;
      items: Array<{
        productName: string;
        quantity: number;
        unitPrice: string;
        lineTotal: string;
        product?: { imageUrl?: string | null } | null;
      }>;
      deliveryAddress: {
        city: string;
        province: string;
        country: string;
      };
      payment: {
        status: string;
        transactionRef: string | null;
        paidAt: string | null;
      } | null;
      delivery: {
        status: string;
        driverName: string | null;
        trackingNumber: string | null;
        estimatedDate: string | null;
        // CP14
        failedReason: string | null;
        transporter: { businessName: string } | null;
      } | null;
    }>
  >([]);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [ordersError, setOrdersError] = useState("");
  const [cancellingOrderId, setCancellingOrderId] = useState<string | null>(
    null,
  );
  const [orderActionError, setOrderActionError] = useState("");
  const [paymentEntryOrderId, setPaymentEntryOrderId] = useState<string | null>(
    null,
  );
  const [paymentRef, setPaymentRef] = useState("");
  const [recordingPaymentId, setRecordingPaymentId] = useState<string | null>(
    null,
  );
  const [orderSearchQuery, setOrderSearchQuery] = useState("");
  const [cartItems, setCartItems] = useState<CartItem[]>([]);
  const [cartOpen, setCartOpen] = useState(false);
  const [cartError, setCartError] = useState("");
  // Drawer states: `cartLoaded` gates the skeleton until the first fetch
  // settles; `cartUpdating` (mirrored into a ref for a synchronous guard)
  // blocks duplicate quantity/remove requests while one is in flight.
  const [cartLoaded, setCartLoaded] = useState(false);
  const [cartUpdating, setCartUpdating] = useState(false);
  const cartUpdatingRef = useRef(false);
  // Desktop (lg+) shell: the shopping column is the page's only scrollable
  // region, so view/product switches reset it next to the window scroll.
  const contentColumnRef = useRef<HTMLDivElement | null>(null);
  const [addingToCart, setAddingToCart] = useState(false);
  const [sessionChecked, setSessionChecked] = useState(false);
  // Mobile shell state: active tab, bell dropdown, quick-add confirmation.
  const [view, setView] = useState<ViewName>(initialView);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  // Guest header (mobile): hamburger dropdown — Become a supplier / Learn
  // more / Sign up / How it works.
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  // CP17: product viewing screen — a full-screen view (not a modal) reached by
  // tapping a listing image. Returns to whichever tab opened it.
  const [productReturnView, setProductReturnView] =
    useState<ViewName>(initialView);
  const [reviews, setReviews] = useState<ProductReviewItem[] | null>(null);
  const [reviewsSummary, setReviewsSummary] = useState<{
    average: number | null;
    count: number;
  } | null>(null);
  const [reviewsLoading, setReviewsLoading] = useState(false);
  const [reviewsError, setReviewsError] = useState("");
  const [myReviewState, setMyReviewState] = useState<{
    canReview: boolean;
    review: { id: string; rating: number; comment: string | null } | null;
  } | null>(null);
  const [reviewForm, setReviewForm] = useState({ rating: 5, comment: "" });
  const [submittingReview, setSubmittingReview] = useState(false);
  const [reviewSubmitError, setReviewSubmitError] = useState("");
  // Bumped after a successful submit to re-run the reviews load effect.
  const [reviewsNonce, setReviewsNonce] = useState(0);
  const [flash, setFlash] = useState<{
    message: string;
    kind: "success" | "error";
  } | null>(null);
  // Guests can browse freely; sign-in-only actions raise this bottom sheet.
  const [authPromptAction, setAuthPromptAction] = useState<string | null>(
    null,
  );

  // The app-style layout is for signed-in buyers. Guests (and the crawler)
  // keep the marketing hero on "/" — the guarded routes only ever render for
  // buyers, so they start in app mode immediately.
  const appMode = initialView !== "home" || currentUser?.role === "BUYER";

  function promptSignIn(action: string) {
    setAuthPromptAction(action);
  }

  const closeAuthPrompt = useCallback(() => setAuthPromptAction(null), []);

  async function handleStartOrder() {
    if (!selectedProduct || ordering) return;

    if (!currentUser) {
      promptSignIn("place an order");
      return;
    }

    if (!selectedAddressId) {
      setAddressError("Please add or select a delivery address before ordering.");
      return;
    }

    setOrdering(true);
    setOrderError("");
    setOrderSuccess(null);

    try {
      const response = await fetch(`${API_BASE_URL}/api/orders`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...authHeaders(),
        },
        body: JSON.stringify({
          deliveryAddressId: selectedAddressId,
          productId: selectedProduct.id,
          quantity: orderQuantity,
          notes: "Development order",
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          Array.isArray(data?.message)
            ? data.message.join(", ")
            : data?.message || "Unable to place order",
        );
      }

      setOrderSuccess({
        orderNumber: data.orderNumber,
        productName: selectedProduct.name,
        quantity: orderQuantity,
        total: String(data.total),
        location: data.deliveryAddress?.city
          ? `${data.deliveryAddress.city}, ${data.deliveryAddress.province}`
          : selectedProduct.location,
        status: data.status,
      });

      await loadOrders();
      closeProduct();
    } catch (error) {
      setOrderError(
        error instanceof Error
          ? error.message
          : "Unable to place order. Please try again.",
      );
    } finally {
      setOrdering(false);
    }
  }

  // Add the product screen's product + quantity to the buyer cart. On the
  // product viewing screen the confirmation is a toast (the screen stays put);
  // the desktop guest layout still reveals the cart drawer.
  async function handleAddToCart(
    quickProduct?: Product,
    quickQuantity?: number,
  ) {
    const onProductScreen = Boolean(selectedProduct);
    const product = quickProduct ?? selectedProduct;
    const quantity = quickQuantity ?? orderQuantity;

    if (!product || addingToCart) return;

    if (!currentUser) {
      promptSignIn("add items to your cart");
      return;
    }

    setAddingToCart(true);
    setOrderError("");
    setCartError("");

    try {
      const response = await fetch(`${API_BASE_URL}/api/cart/items`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...authHeaders(),
        },
        body: JSON.stringify({
          productId: product.id,
          quantity,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          Array.isArray(data?.message)
            ? data.message.join(", ")
            : data?.message || "Unable to add to cart",
        );
      }

      await loadCart();

      if (!appMode) {
        // Desktop guest layout: reveal the cart drawer so the new line is
        // immediately visible.
        setCartOpen(true);
      } else {
        // Mobile shell (grid quick-add or product screen): confirm inline.
        setFlash({ message: "Added to cart", kind: "success" });
      }
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Unable to add to cart. Please try again.";

      if (onProductScreen) {
        setOrderError(message);
      } else {
        setFlash({ message, kind: "error" });
      }
    } finally {
      setAddingToCart(false);
    }
  }

  useEffect(() => {
    let cancelled = false;

    async function loadSession() {
      const user = await fetchCurrentUser();

      if (!cancelled) {
        setCurrentUser(user);
        setSessionChecked(true);
      }
    }

    void loadSession();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadCategoryImages() {
      try {
        const response = await fetch(`${API_BASE_URL}/api/categories`);
        if (!response.ok) return;
        const data = (await response.json()) as Array<{
          name: string;
          slug?: string;
          imageUrl?: string | null;
        }>;
        if (!cancelled && Array.isArray(data)) {
          const map: Record<string, string | null> = {};
          const options: Array<{ name: string; slug: string }> = [];
          for (const item of data) {
            if (item.name) {
              map[item.name] = item.imageUrl ?? null;
              options.push({
                name: item.name,
                slug: item.slug ?? CATEGORY_SLUGS[item.name] ?? "",
              });
            }
          }
          setCategoryImages(map);
          setCategoryOptions(options);

          // A shared ?cat= link can point at a category created after the
          // static map was written; resolve it against the live list.
          if (initialCategory) {
            const resolved =
              options.find(
                (option) =>
                  option.name === initialCategory ||
                  option.slug === initialCategory,
              )?.name ?? resolveCategoryName(initialCategory);

            if (resolved) {
              setActiveCategory(resolved);
              setFilters((current) => ({ ...current, category: resolved }));
            }
          }
        }
      } catch {
        // Fall back gracefully to icons
      }
    }

    void loadCategoryImages();

    return () => {
      cancelled = true;
    };
  }, [initialCategory]);

  useEffect(() => {
    if (!currentUser || currentUser.role !== "BUYER") {
      return;
    }

    let cancelled = false;

    async function loadAddresses() {
      try {
        setAddressesLoading(true);
        setAddressError("");

        const response = await fetch(`${API_BASE_URL}/api/addresses`, {
          cache: "no-store",
          headers: authHeaders(),
        });

        const data = await response.json();

        if (!response.ok) {
          throw new Error(
            Array.isArray(data?.message)
              ? data.message.join(", ")
              : data?.message || "Unable to load delivery addresses.",
          );
        }

        const loadedAddresses = Array.isArray(data)
          ? (data as Address[])
          : [];

        if (!cancelled) {
          setAddresses(loadedAddresses);

          const defaultAddress =
            loadedAddresses.find((address) => address.isDefault) ??
            loadedAddresses[0];

          setSelectedAddressId(defaultAddress?.id ?? "");
        }
      } catch (error) {
        if (!cancelled) {
          setAddressError(
            error instanceof Error
              ? error.message
              : "Unable to load delivery addresses.",
          );
        }
      } finally {
        if (!cancelled) {
          setAddressesLoading(false);
        }
      }
    }

    void loadAddresses();

    return () => {
      cancelled = true;
    };
  }, [currentUser]);

  // Silent refresh after a delivery pin is saved from the cart screen —
  // keeps the selected address (only the rows are replaced).
  async function refreshAddresses() {
    try {
      const response = await fetch(`${API_BASE_URL}/api/addresses`, {
        cache: "no-store",
        headers: authHeaders(),
      });

      if (!response.ok) return;

      const data = await response.json();
      if (Array.isArray(data)) {
        setAddresses(data as Address[]);
      }
    } catch {
      // A failed refresh leaves the current list in place — never fatal.
    }
  }

  // Facets power the filter sheet; one bounded read, no per-keystroke cost.
  useEffect(() => {
    let cancelled = false;

    async function loadFacets() {
      try {
        const response = await fetch(`${API_BASE_URL}/api/products/facets`);
        if (!response.ok) return;
        const data = (await response.json()) as ProductFacets;
        if (!cancelled) setFacets(data);
      } catch {
        // The sheet simply hides location/seller sections without facets.
      }
    }

    void loadFacets();

    return () => {
      cancelled = true;
    };
  }, []);

  // Typing stays instant; the read waits for a 300 ms pause.
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search), 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  // Shared query for the paged catalog reads (search/filters only — the
  // caller adds take/skip).
  const buildProductParams = useCallback(
    (options: { skip: number }) => {
      const params = new URLSearchParams();

      if (debouncedSearch.trim()) {
        params.set("search", debouncedSearch.trim());
      }

      if (activeCategory !== "All") {
        const slug =
          categoryOptions.find((option) => option.name === activeCategory)
            ?.slug ?? CATEGORY_SLUGS[activeCategory];

        if (slug) {
          params.set("category", slug);
        }
      }

      const minPrice = Number(filters.minPrice);
      const maxPrice = Number(filters.maxPrice);

      if (filters.minPrice.trim() && Number.isFinite(minPrice)) {
        params.set("minPrice", String(minPrice));
      }

      if (filters.maxPrice.trim() && Number.isFinite(maxPrice)) {
        params.set("maxPrice", String(maxPrice));
      }

      if (filters.province) params.set("province", filters.province);
      if (filters.city) params.set("city", filters.city);
      if (filters.supplierId) params.set("supplierId", filters.supplierId);
      if (filters.sort !== "relevance") params.set("sort", filters.sort);

      params.set("take", String(PRODUCTS_PAGE_SIZE));
      params.set("skip", String(options.skip));

      return params;
    },
    [
      PRODUCTS_PAGE_SIZE,
      debouncedSearch,
      activeCategory,
      categoryOptions,
      filters.minPrice,
      filters.maxPrice,
      filters.province,
      filters.city,
      filters.supplierId,
      filters.sort,
    ],
  );

  useEffect(() => {
    const controller = new AbortController();

    async function loadProducts() {
      try {
        setError("");
        setLoadMoreError("");

        if (loadedProductsOnce.current) {
          // Keep the current grid on screen while the next query resolves so
          // typing never flashes an empty marketplace.
          setRefreshingProducts(true);
        } else {
          setLoading(true);
        }

        const params = buildProductParams({ skip: 0 });
        const response = await fetch(
          `${API_BASE_URL}/api/products?${params.toString()}`,
          { signal: controller.signal },
        );

        if (!response.ok) {
          throw new Error(`Products request failed: ${response.status}`);
        }

        const data: ApiProduct[] = await response.json();

        setProducts(data.map(mapApiProduct));
        setProductPage(0);
        setHasMoreProducts(data.length === PRODUCTS_PAGE_SIZE);
        loadedProductsOnce.current = true;
      } catch (requestError) {
        if (controller.signal.aborted) return;

        setError(
          requestError instanceof Error
            ? requestError.message
            : "Unable to load products.",
        );
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
          setRefreshingProducts(false);
        }
      }
    }

    void loadProducts();

    return () => {
      controller.abort();
    };
  }, [
    buildProductParams,
    PRODUCTS_PAGE_SIZE,
    productsNonce,
  ]);

  const loadMoreProducts = useCallback(async () => {
    if (
      loadingMoreProducts ||
      loading ||
      refreshingProducts ||
      error ||
      loadMoreError ||
      !hasMoreProducts
    ) {
      return;
    }

    const nextSkip = (productPage + 1) * PRODUCTS_PAGE_SIZE;
    setLoadingMoreProducts(true);

    try {
      const params = buildProductParams({ skip: nextSkip });
      const response = await fetch(
        `${API_BASE_URL}/api/products?${params.toString()}`,
      );

      if (!response.ok) {
        throw new Error(`Products request failed: ${response.status}`);
      }

      const data: ApiProduct[] = await response.json();

      setProducts((current) => [
        ...current,
        ...data.map(mapApiProduct),
      ]);
      setProductPage(productPage + 1);
      setHasMoreProducts(data.length === PRODUCTS_PAGE_SIZE);
      setLoadMoreError("");
    } catch {
      // A failed page must not clear what the buyer is already seeing. Stop
      // polling the sentinel and let the retry control resume the scroll feed.
      setLoadMoreError("We could not load more products.");
    } finally {
      setLoadingMoreProducts(false);
    }
  }, [
    PRODUCTS_PAGE_SIZE,
    buildProductParams,
    error,
    hasMoreProducts,
    loadMoreError,
    loading,
    loadingMoreProducts,
    productPage,
    refreshingProducts,
  ]);

  // Auto-load the next page as the buyer scrolls towards the end of the list.
  // The sentinel lives in state, not a ref, so switching between the home and
  // explore feeds always measures the element that is actually on screen.
  //
  // This is a scroll listener rather than an IntersectionObserver: BonAgri is
  // also opened inside embedded webviews that never deliver intersection
  // callbacks, and a listener re-checks the moment the list settles instead of
  // only on a visibility transition an observer would have missed.
  const productsFeedBusy = loading || refreshingProducts || loadingMoreProducts;
  const scrollFeedReady = hasMoreProducts && !loadMoreError && !productsFeedBusy;

  useEffect(() => {
    if (!sentinelNode || !scrollFeedReady) return;

    let frame = 0;

    const check = () => {
      if (frame) return;

      frame = requestAnimationFrame(() => {
        frame = 0;
        const distance =
          sentinelNode.getBoundingClientRect().top - window.innerHeight;

        if (distance <= SCROLL_FEED_MARGIN_PX) {
          void loadMoreProducts();
        }
      });
    };

    check();
    window.addEventListener("scroll", check, { passive: true, capture: true });
    window.addEventListener("resize", check);

    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener("scroll", check, { capture: true });
      window.removeEventListener("resize", check);
    };
  }, [loadMoreProducts, scrollFeedReady, sentinelNode]);

  const loadOrders = useCallback(async () => {
    if (!currentUser) {
      setOrders([]);
      return;
    }

    try {
      setOrdersLoading(true);
      setOrdersError("");

      const response = await fetch(`${API_BASE_URL}/api/orders`, {
        cache: "no-store",
        headers: authHeaders(),
      });

      if (!response.ok) {
        throw new Error(`Orders request failed: ${response.status}`);
      }

      const data = await response.json();

      setOrders(data);
    } catch (requestError) {
      setOrdersError(
        requestError instanceof Error
          ? requestError.message
          : "Unable to load orders.",
      );
    } finally {
      setOrdersLoading(false);
    }
  }, [currentUser]);

  useEffect(() => {
    void loadOrders();
  }, [loadOrders]);

  const loadCart = useCallback(async () => {
    if (!currentUser || currentUser.role !== "BUYER") {
      setCartItems([]);
      setCartLoaded(true);
      return;
    }

    try {
      const response = await fetch(`${API_BASE_URL}/api/cart`, {
        cache: "no-store",
        headers: authHeaders(),
      });

      if (!response.ok) {
        return;
      }

      const data = await response.json();

      setCartItems(Array.isArray(data) ? (data as CartItem[]) : []);
    } catch {
      // Silent: a stale cart badge is better than breaking the page.
    } finally {
      setCartLoaded(true);
    }
  }, [currentUser]);

  useEffect(() => {
    void loadCart();
  }, [loadCart]);

  async function patchCartItem(itemId: string, quantity: number) {
    // Synchronous ref guard: a second click before the state round-trips
    // must not fire a duplicate PATCH.
    if (cartUpdatingRef.current) return;
    cartUpdatingRef.current = true;
    setCartUpdating(true);
    setCartError("");

    try {
      const response = await fetch(`${API_BASE_URL}/api/cart/items/${itemId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...authHeaders(),
        },
        body: JSON.stringify({ quantity }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          Array.isArray(data?.message)
            ? data.message.join(", ")
            : data?.message || "Unable to update cart",
        );
      }

      await loadCart();
    } catch (error) {
      setCartError(
        error instanceof Error ? error.message : "Unable to update cart",
      );
      // Re-sync with the server so a failed update never leaves stale totals.
      await loadCart();
    } finally {
      cartUpdatingRef.current = false;
      setCartUpdating(false);
    }
  }

  async function removeCartItem(itemId: string) {
    if (cartUpdatingRef.current) return;
    cartUpdatingRef.current = true;
    setCartUpdating(true);
    setCartError("");

    try {
      const response = await fetch(`${API_BASE_URL}/api/cart/items/${itemId}`, {
        method: "DELETE",
        headers: authHeaders(),
      });

      if (!response.ok) {
        throw new Error("Unable to remove item from cart");
      }

      await loadCart();
    } catch (error) {
      setCartError(
        error instanceof Error ? error.message : "Unable to remove item",
      );
    } finally {
      cartUpdatingRef.current = false;
      setCartUpdating(false);
    }
  }

  const cartCount = cartItems.reduce(
    (total, item) => total + item.quantity,
    0,
  );

  // Desktop header "Deliver to" chip — the address the buyer is actually
  // checking out with (selection first, then their default, then any saved).
  const deliverTo =
    addresses.find((address) => address.id === selectedAddressId)?.city ??
    addresses.find((address) => address.isDefault)?.city ??
    addresses[0]?.city ??
    "Add address";

  // Multi-supplier checkouts share one orderGroupId - render each checkout
  // as a single block (group header + its orders) so a buyer sees one entry
  // per checkout instead of loose per-supplier orders.
  const orderRenderList = useMemo(() => {
    const list: Array<{ key: string; orders: typeof orders }> = [];
    const groupedKeys = new Set<string>();

    for (const order of orders) {
      if (order.orderGroupId) {
        if (groupedKeys.has(order.orderGroupId)) {
          continue;
        }

        groupedKeys.add(order.orderGroupId);
        list.push({
          key: order.orderGroupId,
          orders: orders.filter((o) => o.orderGroupId === order.orderGroupId),
        });
      } else {
        list.push({ key: order.id, orders: [order] });
      }
    }

    return list;
  }, [orders]);

  const filteredOrderRenderList = useMemo(() => {
    const q = orderSearchQuery.trim().toLowerCase();
    if (!q) return orderRenderList;
    return orderRenderList
      .map((group) => ({
        ...group,
        orders: group.orders.filter(
          (o) =>
            o.orderNumber.toLowerCase().includes(q) ||
            o.status.toLowerCase().includes(q) ||
            (o.deliveryAddress?.city &&
              o.deliveryAddress.city.toLowerCase().includes(q)) ||
            o.items.some((item) => item.productName.toLowerCase().includes(q)),
        ),
      }))
      .filter((group) => group.orders.length > 0);
  }, [orderRenderList, orderSearchQuery]);

  useEffect(() => {
    let cancelled = false;

    // Public demand board (CP7): OPEN product requests, no auth needed.
    async function loadProductRequests() {
      try {
        const response = await fetch(`${API_BASE_URL}/api/product-requests`, {
          cache: "no-store",
        });

        if (response.ok && !cancelled) {
          const data = (await response.json()) as PublicProductRequest[];
          setProductRequests(data.slice(0, 3));
        }
      } catch {
        // Demand board is optional content; the example card covers empty.
      }
    }

    void loadProductRequests();

    return () => {
      cancelled = true;
    };
  }, []);

  async function cancelOrder(orderId: string, orderNumber: string) {
    const confirmed = window.confirm(
      `Cancel order ${orderNumber}? Reserved stock will be released.`,
    );

    if (!confirmed) return;

    setCancellingOrderId(orderId);
    setOrderActionError("");

    try {
      const response = await fetch(
        `${API_BASE_URL}/api/orders/${orderId}/status`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            ...authHeaders(),
          },
          body: JSON.stringify({ status: "CANCELLED" }),
        },
      );

      if (!response.ok) {
        const data = await response.json().catch(() => null);

        throw new Error(
          Array.isArray(data?.message)
            ? data.message.join(", ")
            : data?.message || "Unable to cancel the order",
        );
      }

      await loadOrders();
    } catch (error) {
      setOrderActionError(
        error instanceof Error ? error.message : "Unable to cancel the order",
      );
    } finally {
      setCancellingOrderId(null);
    }
  }

  // CP11: buyer records their manual EFT reference against a pending order.
  async function recordPayment(orderId: string) {
    const reference = paymentRef.trim();

    if (reference.length < 3) {
      setOrderActionError(
        "Enter the EFT reference from your bank (at least 3 characters).",
      );
      return;
    }

    setRecordingPaymentId(orderId);
    setOrderActionError("");

    try {
      const response = await fetch(
        `${API_BASE_URL}/api/orders/${orderId}/payment`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...authHeaders(),
          },
          body: JSON.stringify({ transactionRef: reference }),
        },
      );

      if (!response.ok) {
        const data = await response.json().catch(() => null);

        throw new Error(
          Array.isArray(data?.message)
            ? data.message.join(", ")
            : data?.message || "Unable to record the payment",
        );
      }

      setPaymentEntryOrderId(null);
      setPaymentRef("");
      await loadOrders();
    } catch (error) {
      setOrderActionError(
        error instanceof Error ? error.message : "Unable to record the payment",
      );
    } finally {
      setRecordingPaymentId(null);
    }
  }

  // --- Mobile shell navigation -------------------------------------------------

  function goTo(nextView: ViewName) {
    // Any tab navigation exits the product viewing screen.
    setSelectedProduct(null);

    if (nextView === view) {
      window.scrollTo({ top: 0, behavior: "smooth" });
      contentColumnRef.current?.scrollTo({ top: 0, behavior: "smooth" });
      setNotificationsOpen(false);
      return;
    }

    if (nextView === "home") {
      // The home grid is the broad "browse everything" view.
      setActiveCategory("All");
      setFilters((current) => ({ ...current, category: "All" }));
    }

    setView(nextView);
    setNotificationsOpen(false);
    setCartOpen(false);
    window.scrollTo({ top: 0 });
    contentColumnRef.current?.scrollTo({ top: 0 });
    window.history.pushState(
      { bonagriView: nextView },
      "",
      VIEW_PATHS[nextView],
    );
  }

  function resetReviewState() {
    setReviews(null);
    setReviewsSummary(null);
    setReviewsError("");
    setMyReviewState(null);
    setReviewForm({ rating: 5, comment: "" });
    setReviewSubmitError("");
  }

  // Swap the shell into the product viewing screen without touching history
  // (used by popstate + the direct /products/[id] load).
  function showProduct(product: Product) {
    setOrderQuantity(1);
    setOrderError("");
    setAddressError("");
    setShowAddressForm(false);
    resetReviewState();
    setSelectedProduct(product);
    window.scrollTo({ top: 0 });
    contentColumnRef.current?.scrollTo({ top: 0 });
  }

  function openProduct(product: Product) {
    // Remember which tab to come back to, then land on a real /products/:id
    // URL so the screen is shareable and survives a refresh.
    setProductReturnView(view);
    showProduct(product);
    window.history.pushState(
      { bonagriProduct: product.id },
      "",
      `/products/${product.id}`,
    );
  }

  function closeProduct() {
    setSelectedProduct(null);
    window.history.pushState(
      { bonagriView: productReturnView },
      "",
      VIEW_PATHS[productReturnView],
    );
    window.scrollTo({ top: 0 });
    contentColumnRef.current?.scrollTo({ top: 0 });
  }

  // Fetch a single product by id (used when a /products/:id link is refreshed
  // or the back/forward button lands on an id that is not in the loaded grid).
  async function loadProductById(productId: string): Promise<Product | null> {
    try {
      const response = await fetch(`${API_BASE_URL}/api/products/${productId}`);

      if (!response.ok) {
        return null;
      }

      const data: ApiProduct = await response.json();
      return mapApiProduct(data);
    } catch {
      return null;
    }
  }

  function viewMyOrders() {
    goTo("orders");
  }

  function pickCategory(name: string) {
    setActiveCategory(name);
    setFilters((current) => ({ ...current, category: name }));
    setActiveSegment("All");

    // Guests browse on "/" (the buyer-only /explore route would redirect
    // them to login); signed-in buyers get the explore tab.
    if (appMode) {
      goTo("explore");
      return;
    }

    window.setTimeout(() => {
      document.getElementById("marketplace")?.scrollIntoView({
        behavior: "smooth",
      });
    }, 60);
  }

  function clearCategory() {
    setActiveCategory("All");
    setFilters((current) => ({ ...current, category: "All" }));
    setActiveSegment("All");
  }

  // The sheet and the category row share this one commit path, so the API
  // query, the chips and the visible grid can never disagree.
  function applyFilters(next: MarketplaceFilters) {
    setFilters(next);
    setActiveCategory(next.category || "All");
    setActiveSegment("All");
    setFilterSheetOpen(false);

    if (appMode && view !== "explore") {
      goTo("explore");
    }

    window.setTimeout(() => {
      document.getElementById("marketplace")?.scrollIntoView({
        behavior: "smooth",
      });
    }, 80);
  }

  function resetFilters() {
    applyFilters({ ...DEFAULT_FILTERS });
  }

  function submitSearch(term: string) {
    // Commit immediately on Enter instead of waiting for the debounce.
    setDebouncedSearch(term);

    if (appMode && view !== "explore") {
      goTo("explore");
    }

    window.setTimeout(() => {
      document.getElementById("marketplace")?.scrollIntoView({
        behavior: "smooth",
      });
    }, 80);
  }

  async function openProductById(productId: string) {
    const fromGrid = products.find((product) => product.id === productId);

    if (fromGrid) {
      openProduct(fromGrid);
      return;
    }

    const product = await loadProductById(productId);

    if (product) {
      openProduct(product);
    }
  }

  // Back/forward button restores the tab (and category) from the URL — or the
  // product viewing screen when the URL is a /products/:id path.
  useEffect(() => {
    function handlePopState() {
      const path = window.location.pathname.replace(/\/$/, "") || "/";

      const productMatch = path.match(/^\/products\/([^/]+)$/);

      if (productMatch) {
        const productId = productMatch[1];

        // Prefer the already-loaded grid entry, otherwise fetch the product.
        const fromGrid = products.find((product) => product.id === productId);

        if (fromGrid) {
          showProduct(fromGrid);
        } else {
          void loadProductById(productId).then((product) => {
            if (product) {
              showProduct(product);
            }
          });
        }

        return;
      }

      setSelectedProduct(null);

      const match = (Object.keys(VIEW_PATHS) as ViewName[]).find(
        (key) => VIEW_PATHS[key] === path,
      );

      if (match) {
        setView(match);
      }

      const category = new URLSearchParams(window.location.search).get("cat");
      const categoryName = category
        ? (resolveCategoryName(category) ?? category)
        : "All";
      setActiveCategory(categoryName);
      setFilters((current) => ({ ...current, category: categoryName }));
      setActiveSegment("All");
      setNotificationsOpen(false);
    }

    window.addEventListener("popstate", handlePopState);

    return () => {
      window.removeEventListener("popstate", handlePopState);
    };
    // products is read from the closure on purpose: the handler must see the
    // latest loaded grid without re-subscribing on every fetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [products]);

  // Direct load of a /products/:id route (refresh or shared link): open the
  // product viewing screen once, without pushing a duplicate history entry.
  useEffect(() => {
    if (!initialProductId) return;

    let cancelled = false;

    void (async () => {
      const fromGrid = products.find(
        (product) => product.id === initialProductId,
      );
      const product = fromGrid ?? (await loadProductById(initialProductId));

      if (!cancelled && product) {
        showProduct(product);
      }
    })();

    return () => {
      cancelled = true;
    };
    // One-shot on mount; the grid may not be loaded yet, so the direct fetch
    // is the reliable path.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialProductId]);

  // CP17: load the public review list (and, for buyers, whether this account
  // may still write one) whenever the product viewing screen changes.
  useEffect(() => {
    if (!selectedProduct) return;

    let cancelled = false;
    const productId = selectedProduct.id;

    async function loadReviews() {
      setReviewsLoading(true);
      setReviewsError("");

      try {
        const response = await fetch(
          `${API_BASE_URL}/api/products/${productId}/reviews`,
        );
        const data = await response.json();

        if (!response.ok) {
          throw new Error(
            Array.isArray(data?.message)
              ? data.message.join(", ")
              : data?.message || "Unable to load reviews.",
          );
        }

        if (cancelled) return;

        setReviews(data.items ?? []);
        setReviewsSummary({
          average: data.average ?? null,
          count: data.count ?? 0,
        });
      } catch (error) {
        if (!cancelled) {
          setReviewsError(
            error instanceof Error ? error.message : "Unable to load reviews.",
          );
        }
      } finally {
        if (!cancelled) {
          setReviewsLoading(false);
        }
      }
    }

    void loadReviews();

    // Eligibility for the write-review form (buyer-only endpoint).
    if (currentUser?.role === "BUYER") {
      void (async () => {
        try {
          const response = await fetch(
            `${API_BASE_URL}/api/products/${productId}/reviews/mine`,
            { headers: authHeaders() },
          );

          if (!response.ok) return;

          const data = await response.json();

          if (!cancelled) {
            setMyReviewState({
              canReview: Boolean(data.canReview),
              review: data.review ?? null,
            });
          }
        } catch {
          // The form simply stays hidden if eligibility cannot be checked.
        }
      })();
    }

    return () => {
      cancelled = true;
    };
  }, [selectedProduct, currentUser, reviewsNonce]);

  // CP17: post a review (only reachable when /mine said canReview).
  async function handleSubmitReview(event: FormEvent) {
    event.preventDefault();

    if (!selectedProduct || submittingReview) return;

    if (!currentUser) {
      promptSignIn("post a review");
      return;
    }

    setSubmittingReview(true);
    setReviewSubmitError("");

    try {
      const comment = reviewForm.comment.trim();
      const response = await fetch(
        `${API_BASE_URL}/api/products/${selectedProduct.id}/reviews`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...authHeaders(),
          },
          body: JSON.stringify({
            rating: reviewForm.rating,
            ...(comment ? { comment } : {}),
          }),
        },
      );

      const data = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(
          Array.isArray(data?.message)
            ? data.message.join(", ")
            : data?.message || "Unable to post your review.",
        );
      }

      setReviewForm({ rating: 5, comment: "" });
      setFlash({ message: "Review posted", kind: "success" });
      setReviewsNonce((nonce) => nonce + 1);
    } catch (error) {
      setReviewSubmitError(
        error instanceof Error
          ? error.message
          : "Unable to post your review.",
      );
    } finally {
      setSubmittingReview(false);
    }
  }

  // Keep the explore URL shareable without stacking history entries.
  useEffect(() => {
    if (view !== "explore") return;

    const path =
      activeCategory === "All"
        ? "/explore"
        : `/explore?cat=${encodeURIComponent(activeCategory)}`;

    if (`${window.location.pathname}${window.location.search}` !== path) {
      window.history.replaceState(window.history.state, "", path);
    }
  }, [view, activeCategory]);

  // Auto-dismiss the quick-add confirmation.
  useEffect(() => {
    if (!flash) return;

    const timer = window.setTimeout(() => setFlash(null), 2800);

    return () => {
      window.clearTimeout(timer);
    };
  }, [flash]);

  const filteredProducts = useMemo(() => {
    const query = search.trim().toLowerCase();

    return products.filter((product) => {
      const matchesSearch =
        !query ||
        `${product.name} ${product.category} ${product.location} ${product.supplier} ${product.sku} ${product.description ?? ""}`
          .toLowerCase()
          .includes(query);

      const matchesCategory =
        activeCategory === "All" || product.category === activeCategory;

      const matchesSegment =
        activeSegment === "All" ||
        SEGMENT_CATEGORIES[
          activeSegment as "Produce" | "Tools"
        ].includes(product.category);

      return matchesSearch && matchesCategory && matchesSegment;
    });
  }, [products, search, activeCategory, activeSegment]);

  const activeFilterCount = countActiveFilters(filters);
  const searchCategoryOptions =
    categoryOptions.length > 0
      ? categoryOptions
      : CATEGORY_CARDS.map(([name]) => ({
          name,
          slug: CATEGORY_SLUGS[name] ?? "",
        }));

  // --- Product viewing screen (CP17) ------------------------------------------
  // A full-screen view (not a modal) showing every piece of data the app has
  // for this product, the purchase panel, and the real reviews/ratings.
  if (selectedProduct) {
    const product = selectedProduct;
    const productImageUrl = buildImageUrl(product.imageUrl, 800);
    const outOfStock = product.availableQuantity <= 0;
    const summary =
      reviewsSummary ?? { average: product.ratingAverage, count: product.ratingCount };
    // Eligibility is only meaningful for a signed-in buyer.
    const eligibility = currentUser?.role === "BUYER" ? myReviewState : null;

    return (
      <main className="min-h-screen bg-[#f7f6f0] pb-32 text-[#17251b]">
        {/* Top bar */}
        <header className="sticky top-0 z-30 border-b border-[#dfe3d9] bg-[#f7f6f0]/95 backdrop-blur">
          <div className="mx-auto flex max-w-2xl items-center gap-3 px-4 py-3">
            <button
              type="button"
              onClick={closeProduct}
              aria-label="Back to listings"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[#ccd5ca] bg-white text-[#304635] hover:bg-[#f2f4ef]"
            >
              <ArrowLeftIcon className="h-4 w-4" strokeWidth={2.2} />
            </button>

            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-black text-[#243229]">
                {product.name}
              </div>
              <div className="text-[10px] font-black uppercase tracking-wide text-[#7b867d]">
                {product.category}
              </div>
            </div>

            <button
              type="button"
              onClick={() => goTo("cart")}
              className="relative flex h-9 shrink-0 items-center rounded-full border border-[#ccd5ca] bg-white px-3 text-[11px] font-black text-[#304635] hover:bg-[#f2f4ef]"
              aria-label={`Open cart, ${cartCount} items`}
            >
              Cart
              {cartCount > 0 ? (
                <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[#17633a] px-1 text-[9px] font-black text-white">
                  {cartCount > 9 ? "9+" : cartCount}
                </span>
              ) : null}
            </button>
          </div>
        </header>

        <div className="mx-auto max-w-2xl px-4 pt-4">
          {/* Square product image */}
          <div
            className={`relative aspect-square overflow-hidden rounded-2xl border border-[#dce2d9] ${product.tone}`}
          >
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-4xl font-black tracking-tight text-[#304635]/70">
                {product.visual}
              </span>
            </div>

            {/* CP16b: supplier photo covers the tone panel; on load error it
                hides and the fallback shows again. Plain <img> is deliberate —
                Cloudinary serves the resized bytes. */}
            {productImageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={productImageUrl}
                alt={product.name}
                className="absolute inset-0 h-full w-full object-cover"
                onError={(event) => {
                  event.currentTarget.style.display = "none";
                }}
              />
            ) : null}

            <div className="absolute left-3 top-3 rounded-full bg-white/90 px-2.5 py-1 text-[9px] font-black uppercase tracking-wide text-[#17633a]">
              {product.category}
            </div>

            {product.verified ? (
              <div className="absolute right-3 top-3 flex items-center gap-1 rounded-full bg-white/90 px-2.5 py-1 text-[9px] font-black uppercase tracking-wide text-[#17633a]">
                <CheckIcon className="h-3 w-3" strokeWidth={3} />
                Verified supplier
              </div>
            ) : null}

            {outOfStock ? (
              <div className="absolute inset-0 flex items-center justify-center bg-white/70">
                <span className="rounded-full bg-[#17251b] px-4 py-1.5 text-xs font-black uppercase tracking-wide text-white">
                  Out of stock
                </span>
              </div>
            ) : null}
          </div>

          {/* Identity + price + rating */}
          <div className="mt-4">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] font-bold text-[#566258]">
              <span>{product.supplier}</span>
              {product.verified ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-[#e7f1e6] px-2 py-0.5 text-[9px] font-black uppercase tracking-wide text-[#17633a]">
                  <CheckIcon className="h-3 w-3" strokeWidth={3} />
                  Verified
                </span>
              ) : null}
            </div>

            <h1 className="mt-1.5 text-xl font-black leading-snug text-[#17251b]">
              {product.name}
            </h1>

            <div className="mt-1 flex items-center gap-3 text-xs text-[#7c877e]">
              <span>📍 {product.location}</span>
              <RatingStars average={summary.average} count={summary.count} />
            </div>

            <div className="mt-3 flex items-end justify-between gap-3">
              <div>
                <span className="text-3xl font-black text-[#17633a]">
                  {product.price}
                </span>
                <span className="ml-1 text-sm font-bold text-[#7b867d]">
                  {product.unit}
                </span>
              </div>
              <div className="text-right text-[10px] font-semibold text-[#8a948b]">
                {product.quantity}
              </div>
            </div>

            {product.description ? (
              <p className="mt-3 text-sm leading-6 text-[#566258]">
                {product.description}
              </p>
            ) : null}
          </div>

          {/* Every detail the app holds for this product */}
          <div className="mt-4 grid grid-cols-2 gap-3">
            <div className="rounded-xl bg-[#f4f6f1] p-4">
              <div className="text-[10px] font-black tracking-wider text-[#6d786f]">
                AVAILABLE
              </div>
              <div className="mt-1 text-sm font-black text-[#27382b]">
                {product.quantity}
              </div>
            </div>

            <div className="rounded-xl bg-[#f4f6f1] p-4">
              <div className="text-[10px] font-black tracking-wider text-[#6d786f]">
                LOCATION
              </div>
              <div className="mt-1 text-sm font-black text-[#27382b]">
                {product.location || "—"}
              </div>
            </div>

            <div className="rounded-xl bg-[#f4f6f1] p-4">
              <div className="text-[10px] font-black tracking-wider text-[#6d786f]">
                CATEGORY
              </div>
              <div className="mt-1 text-sm font-black text-[#27382b]">
                {product.category}
              </div>
            </div>

            <div className="rounded-xl bg-[#f4f6f1] p-4">
              <div className="text-[10px] font-black tracking-wider text-[#6d786f]">
                SKU
              </div>
              <div className="mt-1 break-all text-sm font-black text-[#27382b]">
                {product.sku || "—"}
              </div>
            </div>
          </div>

          {/* Supplier card */}
          <div className="mt-3 flex items-center gap-3 rounded-xl border border-[#dce2d9] bg-white p-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#e7f1e6] text-sm font-black text-[#17633a]">
              {product.supplier.charAt(0)}
            </div>
            <div className="min-w-0">
              <div className="truncate text-sm font-black text-[#27382b]">
                {product.supplier}
              </div>
              <div className="text-[11px] font-semibold text-[#7c877e]">
                {product.verified ? (
                  <span className="inline-flex items-center gap-1">
                    <CheckIcon className="h-3 w-3" strokeWidth={3} />
                    Verified supplier
                  </span>
                ) : (
                  "Supplier profile"
                )}
                {product.location ? ` · ${product.location}` : ""}
              </div>
            </div>
          </div>

          {/* Purchase panel — address, quantity, order/cart actions */}
          <div className="mt-3 rounded-xl border border-[#dce2d9] bg-[#f7f8f4] p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-[9px] font-black uppercase tracking-[0.16em] text-[#7b867d]">
                  Delivery address
                </div>
                <div className="mt-1 text-xs text-[#69756c]">
                  Orders are delivered to the address selected below.
                </div>
              </div>

              <button
                type="button"
                onClick={() => setShowAddressForm((visible) => !visible)}
                disabled={ordering}
                className="shrink-0 rounded-lg border border-[#17633a] px-3 py-2 text-[10px] font-black text-[#17633a] hover:bg-[#eaf2e8] disabled:opacity-50"
              >
                {showAddressForm ? "Cancel" : "Add address"}
              </button>
            </div>

            {addressesLoading ? (
              <div className="mt-3 rounded-lg bg-white px-3 py-3 text-xs font-semibold text-[#69756c]">
                Loading your saved addresses...
              </div>
            ) : addresses.length > 0 ? (
              <div className="mt-3">
                <select
                  value={selectedAddressId}
                  onChange={(event) => {
                    setSelectedAddressId(event.target.value);
                    setAddressError("");
                  }}
                  disabled={ordering}
                  className="w-full rounded-xl border border-[#cfd8ce] bg-white px-3 py-3 text-sm font-semibold text-[#27382b] outline-none focus:border-[#17633a]"
                >
                  {addresses.map((address) => (
                    <option key={address.id} value={address.id}>
                      {address.label} — {address.addressLine1}, {address.city}
                      {address.isDefault ? " (Default)" : ""}
                    </option>
                  ))}
                </select>

                {(() => {
                  const selectedAddress = addresses.find(
                    (address) => address.id === selectedAddressId,
                  );

                  if (!selectedAddress) return null;

                  return (
                    <div className="mt-3 rounded-lg bg-white px-3 py-3 text-xs leading-5 text-[#69756c]">
                      <div className="font-black text-[#27382b]">
                        {selectedAddress.recipientName}
                      </div>
                      <div>{selectedAddress.addressLine1}</div>
                      {selectedAddress.addressLine2 && (
                        <div>{selectedAddress.addressLine2}</div>
                      )}
                      <div>
                        {selectedAddress.city}
                        {selectedAddress.province
                          ? `, ${selectedAddress.province}`
                          : ""}
                        {selectedAddress.postalCode
                          ? ` ${selectedAddress.postalCode}`
                          : ""}
                      </div>
                      <div>{selectedAddress.country}</div>
                      <div className="mt-1.5">
                        <span
                          className={`inline-block rounded-full px-2 py-0.5 text-[9px] font-black uppercase tracking-wide ${
                            selectedAddress.lat != null &&
                            selectedAddress.lng != null
                              ? "bg-[#e5f1e4] text-[#17633a]"
                              : "bg-[#eee8c9] text-[#8a6d12]"
                          }`}
                        >
                          {selectedAddress.lat != null &&
                          selectedAddress.lng != null
                            ? "Location confirmed"
                            : "Needs location confirmation"}
                        </span>
                      </div>
                    </div>
                  );
                })()}
              </div>
            ) : (
              <div className="mt-3 rounded-lg border border-dashed border-[#cbd5ca] bg-white px-4 py-4 text-xs text-[#69756c]">
                No delivery address saved yet. Add one below before placing your
                order.
              </div>
            )}

            {showAddressForm && (
              <form
                className="mt-4 grid gap-3 border-t border-[#dce2d9] pt-4"
                onSubmit={async (event) => {
                  event.preventDefault();

                  if (savingAddress) return;

                  try {
                    setSavingAddress(true);
                    setAddressError("");

                    const response = await fetch(`${API_BASE_URL}/api/addresses`, {
                      method: "POST",
                      headers: {
                        "Content-Type": "application/json",
                        ...authHeaders(),
                      },
                      body: JSON.stringify(addressForm),
                    });

                    const data = await response.json();

                    if (!response.ok) {
                      throw new Error(
                        Array.isArray(data?.message)
                          ? data.message.join(", ")
                          : data?.message || "Unable to save address.",
                      );
                    }

                    const newAddress = data as Address;

                    setAddresses((current) => [
                      newAddress,
                      ...current.map((address) => ({
                        ...address,
                        isDefault: newAddress.isDefault
                          ? false
                          : address.isDefault,
                      })),
                    ]);
                    setSelectedAddressId(newAddress.id);
                    setShowAddressForm(false);
                    setAddressForm({
                      label: "Home",
                      recipientName: "",
                      phone: "",
                      addressLine1: "",
                      addressLine2: "",
                      city: "",
                      province: "",
                      postalCode: "",
                      country: "South Africa",
                    });
                  } catch (error) {
                    setAddressError(
                      error instanceof Error
                        ? error.message
                        : "Unable to save address.",
                    );
                  } finally {
                    setSavingAddress(false);
                  }
                }}
              >
                <div className="grid gap-3 sm:grid-cols-2">
                  <input
                    required
                    value={addressForm.label}
                    onChange={(event) =>
                      setAddressForm((form) => ({
                        ...form,
                        label: event.target.value,
                      }))
                    }
                    placeholder="Label e.g. Home"
                    className="rounded-lg border border-[#cfd8ce] bg-white px-3 py-2.5 text-xs outline-none focus:border-[#17633a]"
                  />
                  <input
                    required
                    value={addressForm.recipientName}
                    onChange={(event) =>
                      setAddressForm((form) => ({
                        ...form,
                        recipientName: event.target.value,
                      }))
                    }
                    placeholder="Recipient name"
                    className="rounded-lg border border-[#cfd8ce] bg-white px-3 py-2.5 text-xs outline-none focus:border-[#17633a]"
                  />
                </div>

                <input
                  value={addressForm.phone}
                  onChange={(event) =>
                    setAddressForm((form) => ({
                      ...form,
                      phone: event.target.value,
                    }))
                  }
                  placeholder="Phone"
                  className="rounded-lg border border-[#cfd8ce] bg-white px-3 py-2.5 text-xs outline-none focus:border-[#17633a]"
                />

                <input
                  required
                  value={addressForm.addressLine1}
                  onChange={(event) =>
                    setAddressForm((form) => ({
                      ...form,
                      addressLine1: event.target.value,
                    }))
                  }
                  placeholder="Address line 1"
                  className="rounded-lg border border-[#cfd8ce] bg-white px-3 py-2.5 text-xs outline-none focus:border-[#17633a]"
                />

                <input
                  value={addressForm.addressLine2}
                  onChange={(event) =>
                    setAddressForm((form) => ({
                      ...form,
                      addressLine2: event.target.value,
                    }))
                  }
                  placeholder="Address line 2 (optional)"
                  className="rounded-lg border border-[#cfd8ce] bg-white px-3 py-2.5 text-xs outline-none focus:border-[#17633a]"
                />

                <div className="grid gap-3 sm:grid-cols-2">
                  <input
                    required
                    value={addressForm.city}
                    onChange={(event) =>
                      setAddressForm((form) => ({
                        ...form,
                        city: event.target.value,
                      }))
                    }
                    placeholder="City"
                    className="rounded-lg border border-[#cfd8ce] bg-white px-3 py-2.5 text-xs outline-none focus:border-[#17633a]"
                  />
                  <input
                    value={addressForm.province}
                    onChange={(event) =>
                      setAddressForm((form) => ({
                        ...form,
                        province: event.target.value,
                      }))
                    }
                    placeholder="Province"
                    className="rounded-lg border border-[#cfd8ce] bg-white px-3 py-2.5 text-xs outline-none focus:border-[#17633a]"
                  />
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <input
                    value={addressForm.postalCode}
                    onChange={(event) =>
                      setAddressForm((form) => ({
                        ...form,
                        postalCode: event.target.value,
                      }))
                    }
                    placeholder="Postal code"
                    className="rounded-lg border border-[#cfd8ce] bg-white px-3 py-2.5 text-xs outline-none focus:border-[#17633a]"
                  />
                  <input
                    required
                    value={addressForm.country}
                    onChange={(event) =>
                      setAddressForm((form) => ({
                        ...form,
                        country: event.target.value,
                      }))
                    }
                    placeholder="Country"
                    className="rounded-lg border border-[#cfd8ce] bg-white px-3 py-2.5 text-xs outline-none focus:border-[#17633a]"
                  />
                </div>

                <button
                  type="submit"
                  disabled={savingAddress}
                  className="rounded-lg bg-[#17633a] px-4 py-2.5 text-xs font-black text-white hover:bg-[#0f4d2b] disabled:opacity-60"
                >
                  {savingAddress ? "Saving address..." : "Save delivery address"}
                </button>
              </form>
            )}

            {addressError && (
              <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">
                {addressError}
              </div>
            )}
          </div>

          <div className="mt-3 rounded-xl border border-[#dce2d9] bg-[#f7f8f4] p-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="text-[9px] font-black uppercase tracking-[0.16em] text-[#7b867d]">
                  Order quantity
                </div>
                <div className="mt-1 text-xs text-[#69756c]">
                  Available: {product.quantity}
                </div>
              </div>

              <div className="flex items-center rounded-xl border border-[#cfd8ce] bg-white">
                <button
                  type="button"
                  onClick={() =>
                    setOrderQuantity((quantity) => Math.max(1, quantity - 1))
                  }
                  disabled={ordering || orderQuantity <= 1}
                  className="h-10 w-10 text-lg font-black text-[#17633a] disabled:opacity-40"
                  aria-label="Decrease order quantity"
                >
                  −
                </button>

                <div className="flex h-10 min-w-12 items-center justify-center border-x border-[#dfe5dc] px-3 text-sm font-black">
                  {orderQuantity}
                </div>

                <button
                  type="button"
                  onClick={() =>
                    setOrderQuantity((quantity) =>
                      Math.min(product.availableQuantity, quantity + 1),
                    )
                  }
                  disabled={
                    ordering || orderQuantity >= product.availableQuantity
                  }
                  className="h-10 w-10 text-lg font-black text-[#17633a] disabled:opacity-40"
                  aria-label="Increase order quantity"
                >
                  +
                </button>
              </div>
            </div>

            {orderError && (
              <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">
                {orderError}
              </div>
            )}

            <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="text-xs font-semibold text-[#69756c]">
                {product.verified ? (
                  <span className="inline-flex items-center gap-1">
                    <CheckIcon className="h-3 w-3" strokeWidth={3} />
                    Verified supplier
                  </span>
                ) : (
                  "Supplier profile"
                )}
              </div>

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => handleAddToCart()}
                  disabled={addingToCart || ordering || outOfStock}
                  className="flex-1 rounded-xl border border-[#17633a] px-5 py-3 text-xs font-black text-[#17633a] hover:bg-[#eaf3ec] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {addingToCart ? "Adding..." : "Add to cart"}
                </button>

                <button
                  type="button"
                  onClick={handleStartOrder}
                  disabled={ordering || addingToCart || outOfStock}
                  className="flex-1 rounded-xl bg-[#17633a] px-5 py-3 text-xs font-black text-white hover:bg-[#0f4d2b] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {ordering ? "Placing order..." : "Start order"}
                </button>
              </div>
            </div>
          </div>

          {/* Ratings & reviews (CP17 — real data only) */}
          <section className="mt-6" aria-label="Ratings and reviews">
            <div className="flex items-end justify-between gap-3">
              <div>
                <div className="text-[10px] font-black uppercase tracking-[0.2em] text-[#17633a]">
                  Ratings &amp; reviews
                </div>
                <div className="mt-1">
                  <RatingStars
                    average={summary.average}
                    count={summary.count}
                  />
                </div>
              </div>
            </div>

            {reviewsLoading ? (
              <div className="mt-3 rounded-xl border border-[#dce2d9] bg-white p-4 text-xs font-semibold text-[#69756c]">
                Loading reviews...
              </div>
            ) : reviewsError ? (
              <div className="mt-3 rounded-xl border border-red-200 bg-red-50 p-4 text-xs font-semibold text-red-700">
                {reviewsError}
              </div>
            ) : reviews && reviews.length === 0 ? (
              <div className="mt-3 rounded-xl border border-dashed border-[#cbd5ca] bg-white p-5 text-center text-xs leading-5 text-[#69756c]">
                No reviews yet. Buyers can rate this product once their order
                has been delivered.
              </div>
            ) : reviews ? (
              <ul className="mt-3 space-y-3">
                {reviews.map((review) => (
                  <li
                    key={review.id}
                    className="rounded-xl border border-[#dce2d9] bg-white p-4"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-xs font-black text-[#27382b]">
                        {review.buyerName}
                      </span>
                      <span className="text-[11px] font-semibold text-[#8a948b]">
                        {new Date(review.createdAt).toLocaleDateString("en-ZA", {
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                        })}
                      </span>
                    </div>

                    <div
                      className="mt-1.5 flex items-center gap-1"
                      aria-label={`${review.rating} out of 5 stars`}
                    >
                      <RatingStarsGlyphs value={review.rating} />
                    </div>

                    {review.comment ? (
                      <p className="mt-2 text-xs leading-5 text-[#566258]">
                        {review.comment}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : null}

            {/* Write-review area */}
            {eligibility?.review ? (
              <div className="mt-3 rounded-xl border border-[#cfe0cf] bg-[#f2f8f1] p-4">
                <div className="text-[10px] font-black uppercase tracking-[0.16em] text-[#17633a]">
                  Your review
                </div>
                <div className="mt-1.5 flex items-center gap-1">
                  <RatingStarsGlyphs value={eligibility.review.rating} />
                </div>
                {eligibility.review.comment ? (
                  <p className="mt-1.5 text-xs leading-5 text-[#566258]">
                    {eligibility.review.comment}
                  </p>
                ) : null}
              </div>
            ) : eligibility?.canReview ? (
              <form
                className="mt-3 rounded-xl border border-[#dce2d9] bg-white p-4"
                onSubmit={handleSubmitReview}
              >
                <div className="text-[10px] font-black uppercase tracking-[0.16em] text-[#7b867d]">
                  Write a review
                </div>

                <div className="mt-2 flex items-center gap-1.5">
                  {[1, 2, 3, 4, 5].map((star) => (
                    <button
                      key={star}
                      type="button"
                      onClick={() =>
                        setReviewForm((form) => ({ ...form, rating: star }))
                      }
                      aria-label={`Rate ${star} star${star > 1 ? "s" : ""}`}
                      className={`transition ${
                        star <= reviewForm.rating
                          ? "text-[#e0a92b]"
                          : "text-[#d7ded4]"
                      }`}
                    >
                      <StarIcon className="h-7 w-7" strokeWidth={2} />
                    </button>
                  ))}
                </div>

                <textarea
                  value={reviewForm.comment}
                  onChange={(event) =>
                    setReviewForm((form) => ({
                      ...form,
                      comment: event.target.value,
                    }))
                  }
                  maxLength={500}
                  rows={3}
                  placeholder="How was the quality and delivery? (optional)"
                  className="mt-3 w-full rounded-lg border border-[#cfd8ce] bg-white px-3 py-2.5 text-xs outline-none focus:border-[#17633a]"
                />

                {reviewSubmitError ? (
                  <div className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">
                    {reviewSubmitError}
                  </div>
                ) : null}

                <button
                  type="submit"
                  disabled={submittingReview}
                  className="mt-3 w-full rounded-xl bg-[#17633a] px-4 py-3 text-xs font-black text-white hover:bg-[#0f4d2b] disabled:opacity-60"
                >
                  {submittingReview ? "Posting..." : "Post review"}
                </button>
              </form>
            ) : currentUser?.role === "BUYER" ? (
              <div className="mt-3 rounded-xl border border-dashed border-[#cbd5ca] bg-white p-4 text-xs leading-5 text-[#69756c]">
                You can review this product once your order has been delivered —
                one review per product.
              </div>
            ) : currentUser ? null : (
              <div className="mt-3 rounded-xl border border-dashed border-[#cbd5ca] bg-white p-4 text-xs leading-5 text-[#69756c]">
                <button
                  type="button"
                  onClick={() => promptSignIn("rate this product")}
                  className="font-black text-[#17633a] underline"
                >
                  Sign in
                </button>{" "}
                to rate this product after your order is delivered.
              </div>
            )}
          </section>
        </div>

        {/* Sticky purchase bar */}
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-[#dfe3d9] bg-white/95 backdrop-blur">
          <div className="mx-auto flex max-w-2xl items-center gap-3 px-4 py-3">
            <div className="min-w-0">
              <div className="text-lg font-black leading-none text-[#17633a]">
                {product.price}
                <span className="ml-1 text-[11px] font-bold text-[#7b867d]">
                  {product.unit}
                </span>
              </div>
              <div className="mt-1 truncate text-[10px] font-semibold text-[#8a948b]">
                {product.quantity}
              </div>
            </div>

            <button
              type="button"
              onClick={() => handleAddToCart()}
              disabled={addingToCart || ordering || outOfStock}
              className="ml-auto flex-1 rounded-xl bg-[#17633a] px-5 py-3.5 text-sm font-black text-white hover:bg-[#0f4d2b] disabled:cursor-not-allowed disabled:bg-[#c3ccc2]"
            >
              {addingToCart ? "Adding..." : "Add to Cart"}
            </button>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main
      className={`relative isolate min-h-screen overflow-x-hidden bg-[#f7f6f0] text-[#17251b]${
        // Desktop (lg+) buyer shell: pin the page to the dynamic viewport so
        // the header/sidebar/content split scrolls nothing but the listings.
        // min-h-0 drops the min-h-screen floor (100vh) which would otherwise
        // out-size 100dvh on browsers with dynamic toolbars and reintroduce a
        // page scrollbar. Phones and guests keep the original page scroll.
        appMode && !selectedProduct
          ? " pb-24 lg:pb-0 lg:flex lg:flex-col lg:h-dvh lg:min-h-0 lg:overflow-hidden"
          : ""
      }`}
    >
      {/* Marketing chrome (utility bar, nav, hero) — guests and the crawler
          keep it; signed-in buyers swap to the app shell below. */}
      {!appMode ? (
        <>
      {/* Utility bar (desktop chrome — hidden on phones to match the
          reference header: hamburger / wordmark / sign-in pill). */}
      <div className="hidden bg-[#123722] px-6 py-2 text-center text-[11px] font-semibold tracking-wide text-[#dce7db] lg:block">
        AGRICULTURAL TRADE • LIMPOPO • SOUTH AFRICA
      </div>

      {/* Navigation — borderless on mobile, bordered on desktop. */}
      <header className="sticky top-0 z-20 bg-[#f7f6f0]/95 backdrop-blur lg:border-b lg:border-[#dfe3d9]">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 lg:px-6 lg:py-4">
          <div className="flex items-center gap-2.5 lg:gap-3">
            {!currentUser ? (
              <button
                type="button"
                onClick={() => setMobileMenuOpen((open) => !open)}
                aria-label="Open menu"
                aria-expanded={mobileMenuOpen}
                className="-ml-1.5 rounded-lg p-1.5 text-[#17251b] transition hover:bg-black/5 lg:hidden"
              >
                <MenuIcon className="h-6 w-6" strokeWidth={2} />
              </button>
            ) : null}

            <a href="#" className="flex items-center gap-3">
              <BrandIcon size={40} className="rounded-xl" />
              <div>
                <div className="text-xl font-black tracking-tight">BonAgri</div>
                <div className="hidden text-[8px] font-bold tracking-[0.25em] text-[#778178] lg:block">
                  AGRICULTURAL MARKETPLACE
                </div>
              </div>
            </a>
          </div>

          <nav className="hidden items-center gap-8 text-sm font-bold lg:flex">
            <a href="#marketplace" className="text-[#17633a]">
              Marketplace
            </a>
            <a href="#suppliers" className="text-[#5d695f] hover:text-[#17633a]">
              Suppliers
            </a>
          </nav>

          <div className="flex items-center gap-3">
            {currentUser ? (
              <>
                <Link
                  href="/addresses"
                  className="hidden rounded-lg border border-[#ccd5ca] px-4 py-2.5 text-sm font-bold sm:block"
                >
                  Addresses
                </Link>
                {currentUser.role === "BUYER" ? (
                  <button
                    type="button"
                    onClick={() => setCartOpen(true)}
                    className="relative hidden rounded-lg border border-[#ccd5ca] px-4 py-2.5 text-sm font-bold sm:block"
                    aria-label={`Open cart, ${cartCount} items`}
                  >
                    Cart
                    {cartCount > 0 ? (
                      <span className="absolute -right-2 -top-2 flex h-5 min-w-5 items-center justify-center rounded-full bg-[#17633a] px-1 text-[10px] font-black text-white">
                        {cartCount}
                      </span>
                    ) : null}
                  </button>
                ) : null}
                {currentUser?.role === "BUYER" ? (
                  <Link
                    href="/apply"
                    className="hidden rounded-lg border border-[#ccd5ca] px-4 py-2.5 text-sm font-bold sm:block"
                  >
                    Sell on BonAgri
                  </Link>
                ) : null}
                {currentUser?.role === "TRANSPORTER" ? (
                  <Link
                    href="/transport"
                    className="hidden rounded-lg border border-[#ccd5ca] px-4 py-2.5 text-sm font-bold sm:block"
                  >
                    Transport Hub
                  </Link>
                ) : null}
                <button
                  type="button"
                  onClick={() => setNotificationsOpen((open) => !open)}
                  aria-label="Notifications"
                  className={`relative flex h-10 w-10 items-center justify-center rounded-xl border transition ${
                    notificationsOpen
                      ? "border-[#17633a] bg-[#eaf3ec] text-[#17633a]"
                      : "border-[#ccd5ca] bg-white text-[#344238] hover:border-[#17633a]"
                  }`}
                >
                  <BellIcon className="h-5 w-5" />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    clearAuth();
                    setCurrentUser(null);
                    setOrders([]);
                    router.push("/login");
                  }}
                  className="rounded-lg bg-[#17633a] px-4 py-2.5 text-sm font-bold text-white hover:bg-[#0f4d2b]"
                >
                  Logout
                </button>
              </>
            ) : (
              <>
                {/* Mobile: one Sign-in pill, as in the reference header. */}
                <button
                  type="button"
                  onClick={() => router.push("/login")}
                  className="rounded-full bg-[#17633a] px-6 py-2.5 text-sm font-bold text-white hover:bg-[#0f4d2b] lg:hidden"
                >
                  Sign in
                </button>
                {/* Desktop: sign in + join, as before. */}
                <div className="hidden items-center gap-3 lg:flex">
                  <button
                    type="button"
                    onClick={() => router.push("/login")}
                    className="rounded-lg border border-[#ccd5ca] px-4 py-2.5 text-sm font-bold"
                  >
                    Sign in
                  </button>
                  <button
                    type="button"
                    onClick={() => router.push("/register")}
                    className="rounded-lg bg-[#17633a] px-4 py-2.5 text-sm font-bold text-white hover:bg-[#0f4d2b]"
                  >
                    Join BonAgri
                  </button>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Mobile hamburger menu — guest header only. */}
        {!currentUser && mobileMenuOpen ? (
          <>
            <div
              className="fixed inset-0 z-30 cursor-default bg-black/10"
              onClick={() => setMobileMenuOpen(false)}
            />
            <nav
              aria-label="Menu"
              className="absolute left-4 right-4 top-[calc(100%+8px)] z-40 rounded-2xl border border-[#dfe2d9] bg-white p-2 shadow-2xl"
            >
              <Link
                href="/apply"
                onClick={() => setMobileMenuOpen(false)}
                className="flex items-center justify-between rounded-xl px-4 py-3 text-sm font-bold text-[#243229] transition hover:bg-[#f1f5ef]"
              >
                Become a supplier
                <ArrowRightIcon
                  className="h-4 w-4 text-[#17633a]"
                  strokeWidth={2.2}
                />
              </Link>
              <a
                href="#marketplace"
                onClick={() => setMobileMenuOpen(false)}
                className="flex items-center justify-between rounded-xl px-4 py-3 text-sm font-bold text-[#243229] transition hover:bg-[#f1f5ef]"
              >
                Learn more
                <ArrowRightIcon
                  className="h-4 w-4 text-[#17633a]"
                  strokeWidth={2.2}
                />
              </a>
              <Link
                href="/register"
                onClick={() => setMobileMenuOpen(false)}
                className="flex items-center justify-between rounded-xl px-4 py-3 text-sm font-bold text-[#243229] transition hover:bg-[#f1f5ef]"
              >
                Sign up
                <ArrowRightIcon
                  className="h-4 w-4 text-[#17633a]"
                  strokeWidth={2.2}
                />
              </Link>
              <a
                href="#how-it-works"
                onClick={() => setMobileMenuOpen(false)}
                className="flex items-center justify-between rounded-xl px-4 py-3 text-sm font-bold text-[#243229] transition hover:bg-[#f1f5ef]"
              >
                How it works
                <ArrowRightIcon
                  className="h-4 w-4 text-[#17633a]"
                  strokeWidth={2.2}
                />
              </a>
            </nav>
          </>
        ) : null}

        {notificationsOpen ? (
          <>
            <div
              className="fixed inset-0 z-30 cursor-default bg-black/10"
              onClick={() => setNotificationsOpen(false)}
            />
            <div className="absolute right-6 top-[calc(100%+8px)] z-40 max-h-[70vh] w-96 overflow-y-auto rounded-2xl border border-[#dce2d9] bg-white p-4 shadow-2xl">
              <NotificationsPanel title="Notifications" />
            </div>
          </>
        ) : null}
      </header>

      {/* Guest phones: app-style search + promo carousel above the listings. */}
      {!appMode ? (
        <div className="lg:hidden">
          <div className="mx-auto max-w-2xl px-4 pt-3">
            <MarketplaceSearch
              query={search}
              onQueryChange={setSearch}
              onSubmit={submitSearch}
              onSelectProduct={(productId) => void openProductById(productId)}
              onOpenFilters={() => setFilterSheetOpen(true)}
              onResetFilters={resetFilters}
              activeFilterCount={activeFilterCount}
              results={filteredProducts}
              loading={loading || refreshingProducts}
              error={error}
              onRetry={() => setProductsNonce((nonce) => nonce + 1)}
              categories={searchCategoryOptions}
              onPickCategory={pickCategory}
              placeholder="Search products, brands, or categories..."
            />
          </div>

          <div className="mx-auto max-w-2xl px-4 pt-4">
            <PromoCarousel showRequestSlide={currentUser?.role === "BUYER"} />
          </div>
        </div>
      ) : null}

      {/* Hero — desktop marketing only; phones go straight to the marketplace. */}
      <section className="hidden border-b border-[#dfe4dc] bg-[#e8eee3] lg:block">
        <div className="mx-auto grid max-w-7xl gap-12 px-6 py-16 md:py-20 lg:grid-cols-[1.2fr_.8fr] lg:items-center">
          <div>
            <div className="mb-6 flex items-center gap-3 text-xs font-black uppercase tracking-[0.18em] text-[#17633a]">
              <span className="h-px w-8 bg-[#17633a]" />
              Limpopo — A Home of Agriculture
            </div>

            <h1 className="max-w-4xl text-5xl font-black leading-[1.02] tracking-[-0.045em] md:text-6xl lg:text-7xl">
              Agricultural trade,
              <span className="block text-[#17633a]">connected.</span>
            </h1>

            <p className="mt-6 max-w-2xl text-lg leading-8 text-[#5b675e] md:text-xl">
              Source agricultural products, connect with suppliers and move
              goods through a marketplace designed around real trade.
            </p>

            {/* Search — the same live search + filters as phones. */}
            <MarketplaceSearch
              size="large"
              className="mt-9"
              query={search}
              onQueryChange={setSearch}
              onSubmit={submitSearch}
              onSelectProduct={(productId) => void openProductById(productId)}
              onOpenFilters={() => setFilterSheetOpen(true)}
              onResetFilters={resetFilters}
              activeFilterCount={activeFilterCount}
              results={filteredProducts}
              loading={loading || refreshingProducts}
              error={error}
              onRetry={() => setProductsNonce((nonce) => nonce + 1)}
              categories={searchCategoryOptions}
              onPickCategory={pickCategory}
              placeholder="What agricultural product are you looking for?"
            />

            <div className="mt-5 flex flex-wrap gap-x-6 gap-y-2 text-xs font-semibold text-[#6e796f]">
              <span className="inline-flex items-center gap-1.5">
                <CheckIcon className="h-3.5 w-3.5 text-[#17633a]" strokeWidth={3} />
                Supplier profiles
              </span>
              <span className="inline-flex items-center gap-1.5">
                <CheckIcon className="h-3.5 w-3.5 text-[#17633a]" strokeWidth={3} />
                Product availability
              </span>
              <span className="inline-flex items-center gap-1.5">
                <CheckIcon className="h-3.5 w-3.5 text-[#17633a]" strokeWidth={3} />
                Regional sourcing
              </span>
            </div>
          </div>

          {/* African agricultural visual */}
          <div className="relative">
            <div className="overflow-hidden rounded-[2rem] bg-[#173d26] p-3 shadow-2xl shadow-[#173d26]/20">
              <div className="relative min-h-[390px] overflow-hidden rounded-[1.5rem] bg-[#315d39] p-8 text-white">
                <div className="absolute inset-0 opacity-20">
                  <div className="absolute -right-20 -top-20 h-80 w-80 rounded-full border-[55px] border-[#dce7d7]" />
                  <div className="absolute -bottom-24 -left-24 h-80 w-80 rounded-full border-[60px] border-[#102e1c]" />
                  <div className="absolute right-10 top-1/2 h-24 w-24 rotate-45 border-2 border-[#dce7d7]" />
                </div>

                <div className="relative">
                  <div className="text-[10px] font-black tracking-[0.25em] text-[#cddfca]">
                    FROM FARM TO MARKET
                  </div>

                  <div className="mt-5 max-w-sm text-4xl font-black leading-tight">
                    Built for the way African agriculture trades.
                  </div>

                  <div className="mt-6 max-w-sm text-sm leading-6 text-[#d1ddd2]">
                    A marketplace connecting agricultural supply, commercial
                    demand and movement.
                  </div>
                </div>

                <div className="absolute bottom-8 left-8 right-8 grid grid-cols-3 gap-2">
                  {[
                    ["SOURCE", "Products"],
                    ["TRADE", "Buyers"],
                    ["MOVE", "Delivery"],
                  ].map(([title, label]) => (
                    <div
                      key={title}
                      className="rounded-xl border border-white/15 bg-white/10 p-3 backdrop-blur"
                    >
                      <div className="text-[9px] font-black tracking-widest text-[#cce0cb]">
                        {title}
                      </div>
                      <div className="mt-1 text-xs font-bold">{label}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
        </>
      ) : null}

      {/* Top-left decorative green rhombus / polygon backdrop element */}
      {appMode && !selectedProduct ? (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute left-0 top-0 -z-10 h-[480px] w-full max-w-[500px] overflow-hidden select-none"
        >
          <svg
            viewBox="0 0 460 480"
            fill="none"
            preserveAspectRatio="xMinYMin slice"
            xmlns="http://www.w3.org/2000/svg"
            className="h-full w-full"
          >
            <defs>
              <linearGradient
                id="rhombusGreenPrimary"
                x1="0%"
                y1="0%"
                x2="100%"
                y2="100%"
              >
                <stop offset="0%" stopColor="#14532d" stopOpacity="0.16" />
                <stop offset="50%" stopColor="#17633a" stopOpacity="0.09" />
                <stop offset="100%" stopColor="#15803d" stopOpacity="0.03" />
              </linearGradient>
              <linearGradient
                id="rhombusGreenSecondary"
                x1="0%"
                y1="0%"
                x2="100%"
                y2="100%"
              >
                <stop offset="0%" stopColor="#166534" stopOpacity="0.09" />
                <stop offset="100%" stopColor="#052e16" stopOpacity="0.02" />
              </linearGradient>
              <linearGradient
                id="rhombusGreenFacet"
                x1="0%"
                y1="100%"
                x2="100%"
                y2="0%"
              >
                <stop offset="0%" stopColor="#15803d" stopOpacity="0.07" />
                <stop offset="100%" stopColor="#22c55e" stopOpacity="0.02" />
              </linearGradient>
            </defs>

            {/* Main faceted rhombus cutting across top-left behind header and search bar */}
            <polygon
              points="-40,-40 340,-40 220,380 -40,280"
              fill="url(#rhombusGreenPrimary)"
            />

            {/* Lower geometric facet continuing down behind the top of the ad carousel */}
            <polygon
              points="-40,280 220,380 140,460 -40,420"
              fill="url(#rhombusGreenSecondary)"
            />

            {/* Corner geometric facet fold */}
            <polygon
              points="340,-40 420,-40 280,240 220,380"
              fill="url(#rhombusGreenFacet)"
            />
          </svg>
        </div>
      ) : null}

      {appMode && !selectedProduct ? (
        <AppHeader
          cartCount={cartCount}
          notificationsOpen={notificationsOpen}
          notificationsPanel={<NotificationsPanel title="Notifications" />}
          showSearch={view === "home" || view === "explore"}
          searchSlot={
            <MarketplaceSearch
              query={search}
              onQueryChange={setSearch}
              onSubmit={submitSearch}
              onSelectProduct={(productId) => void openProductById(productId)}
              onOpenFilters={() => setFilterSheetOpen(true)}
              onResetFilters={resetFilters}
              activeFilterCount={activeFilterCount}
              results={filteredProducts}
              loading={loading || refreshingProducts}
              error={error}
              onRetry={() => setProductsNonce((nonce) => nonce + 1)}
              categories={searchCategoryOptions}
              onPickCategory={pickCategory}
              placeholder="Search products, brands, or categories..."
            />
          }
          onCart={() => {
            if (sessionChecked && !currentUser) {
              promptSignIn("open your cart");
              return;
            }
            // Desktop (lg+): slide the mini cart drawer over the current
            // page. Mobile keeps the existing full-cart navigation.
            if (
              currentUser?.role === "BUYER" &&
              window.matchMedia("(min-width: 1024px)").matches
            ) {
              setCartOpen(true);
              return;
            }
            goTo("cart");
          }}
          onToggleNotifications={() => {
            if (sessionChecked && !currentUser) {
              promptSignIn("view notifications");
              return;
            }
            setNotificationsOpen((open) => !open);
          }}
          user={currentUser}
          deliverTo={deliverTo}
          onSubmitSearch={() => submitSearch(search)}
          onSignOut={() => {
            clearAuth();
            setCurrentUser(null);
            setOrders([]);
            setCartItems([]);
            router.push("/login");
          }}
        />
      ) : null}

      {/* Desktop widescreen composition: sidebar + shopping column. Below lg
          this wrapper is an unstyled block, so the phone shell renders exactly
          as before. */}
      <div
        className={
          appMode && !selectedProduct
            ? "mx-auto w-full max-w-[1600px] lg:flex lg:items-start lg:gap-6 lg:px-6 lg:flex-1 lg:min-h-0"
            : ""
        }
      >
        {appMode && !selectedProduct ? (
          <BuyerSidebar
            view={view}
            activeCategory={activeCategory}
            categories={CATEGORY_CARDS.map(([name]) => name)}
            cartCount={cartCount}
            user={currentUser}
            onNavigate={goTo}
            onPickCategory={pickCategory}
            onSignOut={() => {
              clearAuth();
              setCurrentUser(null);
              setOrders([]);
              setCartItems([]);
              router.push("/login");
            }}
          />
        ) : null}

        <div
          ref={contentColumnRef}
          className={
            appMode && !selectedProduct
              ? "lg:min-w-0 lg:flex-1 lg:self-stretch lg:min-h-0 lg:overflow-y-auto lg:overflow-x-hidden"
              : ""
          }
        >
      {appMode && view === "home" ? (
        <div className="relative z-10 mx-auto max-w-2xl space-y-5 px-4 pt-4 lg:max-w-none lg:px-0">
          <PromoCarousel showRequestSlide={currentUser?.role === "BUYER"} />
          <CategoryRow
            categories={CATEGORY_CARDS.map(([name]) => name)}
            active={activeCategory}
            categoryImages={categoryImages}
            onPick={pickCategory}
            onViewAll={() => goTo("explore")}
          />
        </div>
      ) : null}

      {appMode && view === "explore" ? (
        <div className="relative z-10 mx-auto max-w-2xl px-4 pt-4 lg:max-w-none lg:px-0">
          <CategoryRow
            categories={CATEGORY_CARDS.map(([name]) => name)}
            active={activeCategory}
            categoryImages={categoryImages}
            onPick={pickCategory}
            onViewAll={clearCategory}
          />
        </div>
      ) : null}

      {appMode && view === "cart" ? (
        <div className="relative z-10">
          <CartScreen
            items={cartItems}
            addresses={addresses}
            error={cartError}
            onPatch={patchCartItem}
            onRemove={removeCartItem}
            onBrowse={() => goTo("explore")}
            onAddressUpdated={() => void refreshAddresses()}
          />
        </div>
      ) : null}

      {appMode && view === "profile" ? (
        <div className="relative z-10">
          {currentUser ? (
            <ProfileScreen
              user={currentUser}
              orderCount={orders.length}
              cartCount={cartCount}
              notificationsPanel={<NotificationsPanel title="Notifications" />}
              initialScreen={initialProfileScreen}
              onNavigate={goTo}
              onViewOrders={viewMyOrders}
              onUserUpdated={setCurrentUser}
              onSignOut={() => {
                clearAuth();
                setCurrentUser(null);
                setOrders([]);
                setCartItems([]);
                router.push("/");
              }}
            />
          ) : sessionChecked ? (
            <div className="mx-auto max-w-2xl px-4 py-10">
              <div className="rounded-2xl border border-dashed border-[#cbd5ca] bg-white p-8 text-center">
                <div className="text-sm font-black text-[#243229]">
                  Session ended
                </div>
                <p className="mt-1.5 text-xs leading-5 text-[#69756c]">
                  Sign in again to see your profile, orders and cart.
                </p>
                <button
                  type="button"
                  onClick={() => router.push("/login")}
                  className="mt-5 rounded-xl bg-[#17633a] px-5 py-3 text-xs font-black text-white hover:bg-[#0f4d2b]"
                >
                  Sign in
                </button>
              </div>
            </div>
          ) : (
            <div className="mx-auto max-w-2xl px-4 py-16 text-center text-sm font-semibold text-[#17633a]">
              Loading your profile...
            </div>
          )}
        </div>
      ) : null}

      {/* Marketplace */}
      <section
        id="marketplace"
        className={
          appMode
            ? view === "home" || view === "explore"
              ? "relative z-10 mx-auto max-w-2xl px-4 pb-6 lg:max-w-none lg:px-0 lg:pb-10"
              : "hidden"
            : "mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:py-16"
        }
      >
        {appMode ? (
          <>
            {view === "home" || view === "explore" ? (
              <>
                <div className="flex items-end justify-between gap-3 pb-3 pt-4">
                  <div>
                    <div className="text-[10px] font-black uppercase tracking-[0.2em] text-[#17633a]">
                      {view === "home"
                        ? "Fresh on the market"
                        : "Explore supply"}
                    </div>
                    <h2 className="mt-1 text-lg font-black tracking-tight">
                      {view === "home"
                        ? "Popular products"
                        : activeCategory === "All"
                          ? "All products"
                          : activeCategory}
                    </h2>
                  </div>

                  {view === "home" ? (
                    <button
                      type="button"
                      onClick={() => goTo("explore")}
                      className="text-[11px] font-black uppercase tracking-wide text-[#17633a]"
                    >
                      View all
                    </button>
                  ) : (
                    <div className="text-right">
                      <div className="text-[11px] font-semibold text-[#7a847c]">
                        {filteredProducts.length}{" "}
                        {filteredProducts.length === 1 ? "result" : "results"}
                      </div>
                      {refreshingProducts ? (
                        <div className="text-[9px] font-bold uppercase tracking-wide text-[#17633a]">
                          Updating...
                        </div>
                      ) : null}
                    </div>
                  )}
                </div>

                {activeFilterCount > 0 || filters.sort !== "relevance" ? (
                  <div className="pb-3">
                    <FilterChips
                      filters={filters}
                      facets={facets}
                      onChange={applyFilters}
                    />
                  </div>
                ) : null}

                {view === "home" ? (
                  <ProductRail
                    title="Trending now"
                    sort="trending"
                    onOpen={openProduct}
                  />
                ) : null}

                {loading ? (
                  <ProductGridSkeleton count={8} />
                ) : error ? (
                  <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-3 text-xs font-semibold text-red-700">
                    Unable to load supply: {error}
                    <button
                      type="button"
                      onClick={() => setProductsNonce((nonce) => nonce + 1)}
                      className="ml-3 font-black underline"
                    >
                      Retry
                    </button>
                  </div>
                ) : filteredProducts.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-[#cbd5ca] bg-white p-8 text-center">
                    <div className="text-sm font-black text-[#243229]">
                      {search.trim()
                        ? `No products match “${search.trim()}”`
                        : "No matching supply found"}
                    </div>
                    <p className="mx-auto mt-1 max-w-xs text-xs leading-5 text-[#69756c]">
                      Check the spelling, try a different keyword, or relax
                      your filters.
                    </p>
                    <div className="mt-4 flex flex-wrap justify-center gap-2">
                      {search.trim() ? (
                        <button
                          type="button"
                          onClick={() => setSearch("")}
                          className="rounded-lg border border-[#d5ddd3] px-3 py-2 text-[11px] font-bold text-[#334138] hover:bg-[#f4f7f2]"
                        >
                          Clear search
                        </button>
                      ) : null}
                      {activeFilterCount ? (
                        <button
                          type="button"
                          onClick={resetFilters}
                          className="rounded-lg border border-[#d5ddd3] px-3 py-2 text-[11px] font-bold text-[#334138] hover:bg-[#f4f7f2]"
                        >
                          Reset filters
                        </button>
                      ) : null}
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-[repeat(auto-fill,minmax(210px,1fr))] lg:gap-4">
                    {(view === "home"
                      ? filteredProducts.slice(0, 3)
                      : filteredProducts.slice(0, 4)
                    ).map((product) => (
                      <ProductCard
                        key={product.id}
                        product={product}
                        onOpen={() => openProduct(product)}
                        onAdd={() => void handleAddToCart(product, 1)}
                      />
                    ))}

                    <PromotionFeed
                      placement={
                        view === "home" ? "HOME_TOP" : "EXPLORE_TOP"
                      }
                      className="col-span-full"
                    />

                    {(view === "home"
                      ? filteredProducts.slice(3, 6)
                      : filteredProducts.slice(4, 8)
                    ).map((product) => (
                      <ProductCard
                        key={product.id}
                        product={product}
                        onOpen={() => openProduct(product)}
                        onAdd={() => void handleAddToCart(product, 1)}
                      />
                    ))}

                    <PromotionFeed
                      placement={
                        view === "home" ? "HOME_MID" : "EXPLORE_MID"
                      }
                      className="col-span-full"
                    />

                    {view === "explore"
                      ? filteredProducts.slice(8).map((product) => (
                          <ProductCard
                            key={product.id}
                            product={product}
                            onOpen={() => openProduct(product)}
                            onAdd={() => void handleAddToCart(product, 1)}
                          />
                        ))
                      : null}
                  </div>
                )}

                {view === "explore" &&
                !loading &&
                !error &&
                filteredProducts.length > 0 ? (
                  <ProductScrollFeed
                    hasMore={hasMoreProducts}
                    loading={loadingMoreProducts}
                    error={loadMoreError}
                    onRetry={() => setLoadMoreError("")}
                    onSentinel={setSentinelNode}
                  />
                ) : null}

                {/* The buyer home is a scroll feed: everything past the curated
                    six appends below and the sentinel keeps pulling pages in,
                    so no manual "view all" tap is needed. */}
                {view === "home" &&
                !loading &&
                !error &&
                filteredProducts.length > 6 ? (
                  <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-[repeat(auto-fill,minmax(210px,1fr))] lg:gap-4">
                    {filteredProducts.slice(6).map((product) => (
                      <ProductCard
                        key={product.id}
                        product={product}
                        onOpen={() => openProduct(product)}
                        onAdd={() => void handleAddToCart(product, 1)}
                      />
                    ))}
                  </div>
                ) : null}

                {view === "home" && !loading && !error ? (
                  <ProductScrollFeed
                    hasMore={hasMoreProducts}
                    loading={loadingMoreProducts}
                    error={loadMoreError}
                    onRetry={() => setLoadMoreError("")}
                    onSentinel={setSentinelNode}
                  />
                ) : null}
              </>
            ) : null}
          </>
        ) : (
          <>
        {/* Buyer-home style header — same compact block the signed-in
            home screen uses. */}
        <div className="flex items-end justify-between gap-3 pb-3 pt-4">
          <div>
            <div className="text-[10px] font-black uppercase tracking-[0.2em] text-[#17633a]">
              Fresh on the market
            </div>
            <h2 className="mt-1 text-lg font-black tracking-tight">
              {activeCategory === "All" ? "Popular products" : activeCategory}
            </h2>
          </div>

          {!loading && !error ? (
            <div className="text-right">
              <div className="text-[11px] font-semibold text-[#7a847c]">
                {filteredProducts.length}{" "}
                {filteredProducts.length === 1 ? "result" : "results"}
              </div>
              {refreshingProducts ? (
                <div className="text-[9px] font-bold uppercase tracking-wide text-[#17633a]">
                  Updating...
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        {/* Category pills — exactly the buyer home screen's row. */}
        <CategoryRow
          categories={CATEGORY_CARDS.map(([name]) => name)}
          active={activeCategory}
          categoryImages={categoryImages}
          onPick={(name) => {
            setActiveCategory(name);
            setFilters((current) => ({ ...current, category: name }));
            setActiveSegment("All");
            document
              .getElementById("marketplace")
              ?.scrollIntoView({ behavior: "smooth" });
          }}
          onViewAll={clearCategory}
        />

        <ProductRail
          title="Trending now"
          sort="trending"
          onOpen={openProduct}
        />

        {activeFilterCount > 0 || filters.sort !== "relevance" ? (
          <div className="mt-3">
            <FilterChips
              filters={filters}
              facets={facets}
              onChange={applyFilters}
            />
          </div>
        ) : null}

        {/* Product cards — the buyer home's modern, structured cards. */}
        {loading ? (
          <ProductGridSkeleton count={8} />
        ) : error ? (
          <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-3 py-3 text-xs font-semibold text-red-700">
            Unable to load supply: {error}
            <button
              type="button"
              onClick={() => setProductsNonce((nonce) => nonce + 1)}
              className="ml-3 font-black underline"
            >
              Retry
            </button>
          </div>
        ) : filteredProducts.length === 0 ? (
          <div className="mt-4 rounded-2xl border border-dashed border-[#cbd5ca] bg-white p-8 text-center">
            <div className="text-sm font-black text-[#243229]">
              {search.trim()
                ? `No products match “${search.trim()}”`
                : "No matching supply found"}
            </div>
            <p className="mx-auto mt-1 max-w-xs text-xs leading-5 text-[#69756c]">
              Check the spelling, try a different keyword, or relax your
              filters.
            </p>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              {search.trim() ? (
                <button
                  type="button"
                  onClick={() => setSearch("")}
                  className="rounded-lg border border-[#d5ddd3] px-3 py-2 text-[11px] font-bold text-[#334138] hover:bg-[#f4f7f2]"
                >
                  Clear search
                </button>
              ) : null}
              {activeFilterCount ? (
                <button
                  type="button"
                  onClick={resetFilters}
                  className="rounded-lg border border-[#d5ddd3] px-3 py-2 text-[11px] font-bold text-[#334138] hover:bg-[#f4f7f2]"
                >
                  Reset filters
                </button>
              ) : null}
            </div>
          </div>
        ) : (
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 lg:gap-5">
            {filteredProducts.slice(0, 4).map((product) => (
              <ProductCard
                key={product.id}
                product={product}
                onOpen={() => openProduct(product)}
                onAdd={() => void handleAddToCart(product, 1)}
              />
            ))}

            <PromotionFeed
              placement="HOME_TOP"
              className="col-span-full"
            />

            {filteredProducts.slice(4, 8).map((product) => (
              <ProductCard
                key={product.id}
                product={product}
                onOpen={() => openProduct(product)}
                onAdd={() => void handleAddToCart(product, 1)}
              />
            ))}

            <PromotionFeed
              placement="HOME_MID"
              className="col-span-full"
            />

            {filteredProducts.slice(8).map((product) => (
              <ProductCard
                key={product.id}
                product={product}
                onOpen={() => openProduct(product)}
                onAdd={() => void handleAddToCart(product, 1)}
              />
            ))}
          </div>
        )}

        <ProductRail
          title="New arrivals"
          sort="newest"
          onOpen={openProduct}
        />

        {!loading && !error && filteredProducts.length > 0 ? (
          <ProductScrollFeed
            hasMore={hasMoreProducts}
            loading={loadingMoreProducts}
            error={loadMoreError}
            onRetry={() => setLoadMoreError("")}
            onSentinel={setSentinelNode}
          />
        ) : null}
          </>
        )}

        {/* Desktop mini cart drawer — slides over the current page instead
            of navigating away. Below lg it never opens (the header icon
            keeps the full-cart navigation), so mobile is untouched. */}
        <CartDrawer
          open={cartOpen && currentUser?.role === "BUYER"}
          items={cartItems}
          error={cartError}
          loading={!cartLoaded}
          busy={cartUpdating || addingToCart}
          onPatch={patchCartItem}
          onRemove={removeCartItem}
          onClose={() => setCartOpen(false)}
          onViewCart={() => {
            setCartOpen(false);
            goTo("cart");
          }}
          onCheckout={() => {
            setCartOpen(false);
            router.push("/checkout");
          }}
        />

        {orderSuccess && (
          <div className="fixed bottom-24 left-4 right-4 z-[60] rounded-2xl border border-[#cfe0cf] bg-white p-4 shadow-2xl sm:bottom-6 sm:left-auto sm:right-6 sm:max-w-sm sm:p-5">
            <div className="flex items-start gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#e5f1e4] text-[#17633a]">
                <CheckIcon className="h-4 w-4" strokeWidth={3} />
              </div>

              <div className="min-w-0 flex-1">
                <div className="text-sm font-black text-[#243229]">
                  Order placed
                </div>
                <div className="mt-1 text-xs leading-5 text-[#69756c]">
                  {orderSuccess.productName} • {orderSuccess.quantity} units
                </div>
                <div className="mt-2 text-xs font-black text-[#17633a]">
                  {orderSuccess.orderNumber}
                </div>
                <div className="mt-1 text-xs text-[#69756c]">
                  Total: R{orderSuccess.total} • {orderSuccess.status}
                </div>
              </div>

              <button
                type="button"
                onClick={() => setOrderSuccess(null)}
                className="shrink-0 rounded-full p-1 text-lg font-bold leading-none text-[#7b867d] transition hover:bg-[#f4f6f1] hover:text-[#344238]"
                aria-label="Dismiss order confirmation"
              >
                ×
              </button>
            </div>
          </div>
        )}

      </section>

      {/* Buyer requests — signed-in buyers only. The post-a-request feature
          must never surface for guests or the supplier/admin/transporter
          consoles; suppliers have their own demand board on /supplier. */}
      {currentUser?.role === "BUYER" && view === "home" ? (
      <section id="requests" className="overflow-hidden border-y border-[#dfe4dc] bg-white">
        <div className="mx-auto grid max-w-7xl gap-8 px-4 py-12 sm:gap-12 sm:px-6 sm:py-16 lg:grid-cols-2 lg:items-center">
          <div className="min-w-0">
            <div className="text-xs font-black uppercase tracking-[0.2em] text-[#17633a]">
              Buyer demand
            </div>

            <h2 className="mt-3 text-3xl font-black tracking-tight md:text-4xl">
              Can&apos;t find what you need?
            </h2>

            <p className="mt-4 max-w-xl leading-7 text-[#69756c]">
              Tell suppliers what you are looking for. Product requests can
              capture quantity, location, quality requirements and delivery
              needs.
            </p>

            <button
              onClick={() => router.push("/requests")}
              className="mt-7 rounded-xl bg-[#17633a] px-6 py-3.5 text-sm font-black text-white hover:bg-[#0f4d2b]"
            >
              Post a product request
            </button>
          </div>

          <div className="min-w-0 rounded-2xl border border-[#dce2d9] bg-[#f7f8f4] p-3.5 sm:p-6">
            <div className="text-xs font-black tracking-[0.18em] text-[#7b867d]">
              {productRequests.length > 0 ? "OPEN REQUESTS" : "EXAMPLE REQUEST"}
            </div>

            {productRequests.length > 0 ? (
              <div className="mt-5 space-y-4">
                {productRequests.map((request) => (
                  <article
                    key={request.id}
                    className="min-w-0 overflow-hidden rounded-2xl border border-[#e2e8df] bg-white p-4 shadow-sm transition hover:shadow-md sm:rounded-3xl sm:p-5"
                  >
                    {/* Top Row: Title + Status */}
                    <div className="flex items-start justify-between gap-2.5">
                      <div className="min-w-0 flex-1">
                        <h3 className="truncate text-base font-black text-[#17251b] sm:text-lg">
                          {request.title}
                        </h3>
                        <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-[#7b867d]">
                          <span className="font-semibold text-[#5d695f]">
                            #REQ-{request.id.slice(0, 6).toUpperCase()}
                          </span>
                          <span>·</span>
                          {request.category ? (
                            <>
                              <span className="truncate max-w-[120px] sm:max-w-none">
                                {request.category.name}
                              </span>
                              <span>·</span>
                            </>
                          ) : null}
                          <span>Posted {formatOrderDate(request.createdAt)}</span>
                        </div>
                      </div>

                      <div className="shrink-0 text-right">
                        <div className="text-xs font-bold tracking-tight text-[#17633a] sm:text-sm">
                          Open Request
                        </div>
                        {(request._count?.responses ?? 0) > 0 ? (
                          <span className="mt-1 inline-block rounded-full bg-[#e8f1e6] px-2 py-0.5 text-[9px] font-black uppercase tracking-wide text-[#17633a]">
                            {request._count?.responses} offer
                            {(request._count?.responses ?? 0) === 1 ? "" : "s"}
                          </span>
                        ) : null}
                      </div>
                    </div>

                    {/* Middle Row: Destination & Required By */}
                    <div className="mt-2.5 break-words text-xs text-[#5d695f] sm:text-sm">
                      Destination: {request.destinationCity ?? "Any location"}
                      {request.requiredBy ? (
                        <>
                          {" · Required by "}
                          {new Date(request.requiredBy).toLocaleDateString(
                            "en-ZA",
                            {
                              day: "2-digit",
                              month: "short",
                              year: "numeric",
                            },
                          )}
                        </>
                      ) : null}
                    </div>

                    {/* Dashed divider line matching reference layout */}
                    <div className="my-3 border-t border-dashed border-[#e4eae0] sm:my-3.5" />

                    {/* Bottom Row: Quantity on left, Actions on right */}
                    <div className="flex flex-wrap items-center justify-between gap-2.5">
                      <div className="flex flex-wrap items-baseline gap-1.5 text-xs">
                        <span className="font-semibold text-[#7b867d]">
                          Quantity
                        </span>
                        <span className="text-sm font-black text-[#17251b] sm:text-base">
                          {request.quantity.toLocaleString("en-ZA")}{" "}
                          {request.unit}
                        </span>
                      </div>

                      <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
                        <Link
                          href="/requests"
                          className="rounded-xl bg-[#f4f6f2] px-3 py-1.5 text-xs font-bold text-[#344238] transition hover:bg-[#e8ece5] active:scale-[0.98] sm:px-4 sm:py-2"
                        >
                          Details
                        </Link>

                        <button
                          type="button"
                          onClick={() => router.push("/requests")}
                          className="rounded-xl bg-[#17633a] px-3.5 py-1.5 text-xs font-black text-white shadow-sm transition hover:bg-[#0f4d2b] active:scale-[0.98] sm:px-4 sm:py-2"
                        >
                          Respond
                        </button>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <article className="mt-5 min-w-0 overflow-hidden rounded-2xl border border-[#e2e8df] bg-white p-4 shadow-sm transition hover:shadow-md sm:rounded-3xl sm:p-5">
                {/* Top Row: Title + Status */}
                <div className="flex items-start justify-between gap-2.5">
                  <div className="min-w-0 flex-1">
                    <h3 className="truncate text-base font-black text-[#17251b] sm:text-lg">
                      Tomatoes
                    </h3>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-[#7b867d]">
                      <span className="font-semibold text-[#5d695f]">
                        #REQ-EX01
                      </span>
                      <span>·</span>
                      <span>Fresh produce</span>
                      <span>·</span>
                      <span>Grade 1</span>
                    </div>
                  </div>

                  <div className="shrink-0 text-right">
                    <div className="text-xs font-bold tracking-tight text-[#17633a] sm:text-sm">
                      Open Request
                    </div>
                  </div>
                </div>

                {/* Middle Row */}
                <div className="mt-2.5 break-words text-xs text-[#5d695f] sm:text-sm">
                  Destination: Johannesburg · Required by 05 October · Delivery required
                </div>

                {/* Dashed divider */}
                <div className="my-3 border-t border-dashed border-[#e4eae0] sm:my-3.5" />

                {/* Bottom Row */}
                <div className="flex flex-wrap items-center justify-between gap-2.5">
                  <div className="flex flex-wrap items-baseline gap-1.5 text-xs">
                    <span className="font-semibold text-[#7b867d]">Quantity</span>
                    <span className="text-sm font-black text-[#17251b] sm:text-base">
                      3,000 kg
                    </span>
                  </div>

                  <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
                    <Link
                      href="/requests"
                      className="rounded-xl bg-[#f4f6f2] px-3 py-1.5 text-xs font-bold text-[#344238] transition hover:bg-[#e8ece5] active:scale-[0.98] sm:px-4 sm:py-2"
                    >
                      Details
                    </Link>

                    <button
                      type="button"
                      onClick={() => router.push("/requests")}
                      className="rounded-xl bg-[#17633a] px-3.5 py-1.5 text-xs font-black text-white shadow-sm transition hover:bg-[#0f4d2b] active:scale-[0.98] sm:px-4 sm:py-2"
                    >
                      Post request
                    </button>
                  </div>
                </div>
              </article>
            )}
          </div>
        </div>
      </section>
      ) : null}

      {/* Categories */}
      {!appMode ? (
      <section className="mx-auto max-w-7xl px-6 py-16">
        <div>
          <div className="text-xs font-black uppercase tracking-[0.2em] text-[#17633a]">
            Agricultural supply
          </div>
          <h2 className="mt-2 text-3xl font-black tracking-tight">
            Explore categories
          </h2>
        </div>

        <div className="mt-8 grid gap-4 sm:grid-cols-2 sm:gap-6">
          {CATEGORY_CARDS.map(([name, description], index) => {
            const image = categoryImages[name];
            const Icon = getCategoryIcon(name);

            return (
              <button
                key={name}
                onClick={() => {
                  const segment = Object.entries(SEGMENT_CATEGORIES).find(
                    ([, names]) => names.includes(name),
                  )?.[0];

                  if (segment) {
                    setActiveSegment(segment as "Produce" | "Tools");
                  }

                  setActiveCategory(name);
                  document
                    .getElementById("marketplace")
                    ?.scrollIntoView({ behavior: "smooth" });
                }}
                className="group relative flex min-h-[148px] overflow-hidden rounded-[1.6rem] bg-white text-left shadow-[0_10px_30px_rgba(23,37,27,0.06)] ring-1 ring-[#e4e9df] transition duration-300 hover:-translate-y-1 hover:shadow-[0_20px_44px_rgba(23,37,27,0.13)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#17633a] sm:min-h-[190px]"
              >
                <div className="relative w-[36%] shrink-0 overflow-hidden bg-[linear-gradient(155deg,#eef4e9,#dbe8d5)] sm:w-[40%]">
                  {image ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={image}
                      alt={name}
                      className="absolute inset-0 h-full w-full object-cover transition duration-500 group-hover:scale-105"
                      loading="lazy"
                    />
                  ) : (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
                      <span className="pointer-events-none absolute -right-6 -top-8 h-24 w-24 rounded-full bg-white/50" />
                      <span className="pointer-events-none absolute -bottom-10 -left-8 h-28 w-28 rounded-full bg-[#d8a521]/10" />
                      <span className="relative flex h-12 w-12 items-center justify-center rounded-2xl bg-white text-[#17633a] shadow-[0_8px_20px_rgba(23,37,27,0.12)] ring-1 ring-white sm:h-20 sm:w-20 sm:rounded-[1.4rem]">
                        <Icon className="h-7 w-7 sm:h-10 sm:w-10" />
                      </span>
                      <span className="relative text-[9px] font-black uppercase tracking-[0.2em] text-[#4f6b55]/70">
                        0{index + 1}
                      </span>
                    </div>
                  )}
                </div>

                <div className="flex min-w-0 flex-1 flex-col justify-center px-4 py-4 sm:px-6 sm:py-5">
                  <h3 className="line-clamp-2 text-[16px] font-black leading-tight tracking-tight text-[#17251b] sm:text-[21px]">
                    {name}
                  </h3>
                  <p className="mt-1 line-clamp-2 text-[11px] leading-[1.45] text-[#6b766d] sm:mt-1.5 sm:text-[13px] sm:leading-6">
                    {description}
                  </p>
                  <span className="mt-3 inline-flex items-center gap-1.5 text-[11px] font-black text-[#17633a] sm:text-[13px]">
                    Explore now
                    <ArrowRightIcon
                      className="h-4 w-4 transition duration-300 group-hover:translate-x-1"
                      strokeWidth={2.4}
                    />
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </section>
      ) : null}

      {/* My Orders — signed-in buyers only; guests never see this section. */}
      {appMode && view === "orders" ? (
      <section id="orders" className="border-y border-[#dfe4dc] bg-white">
        {/* Mobile-first container matching the profile screen (max-w-2xl
            px-4); scales up only once the viewport has room for it. */}
        <div className="mx-auto max-w-2xl px-4 py-6 sm:max-w-3xl sm:px-6 sm:py-10">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div className="min-w-0">
              <div className="text-[10px] font-black uppercase tracking-[0.18em] text-[#17633a]">
                Buyer workspace
              </div>
              <h2 className="mt-1.5 text-2xl font-black tracking-tight text-[#17251b] sm:text-3xl">
                My Orders
              </h2>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-[#69756c]">
                Track your agricultural purchases, order status and delivery
                details from one place.
              </p>
            </div>

            <div className="w-fit rounded-full border border-[#dce2d9] bg-[#f7f8f4] px-3.5 py-1.5 text-xs font-black text-[#5d695f]">
              {orders.length} {orders.length === 1 ? "order" : "orders"}
            </div>
          </div>

          <div className="mt-6">
            {orderActionError ? (
              <div
                role="alert"
                className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
              >
                {orderActionError}
              </div>
            ) : null}

            {ordersLoading ? (
              <div className="rounded-2xl border border-[#dce2d9] bg-[#f7f8f4] p-8 text-center">
                <div className="text-sm font-bold text-[#17633a]">
                  Loading your orders...
                </div>
              </div>
            ) : ordersError ? (
              <div className="rounded-2xl border border-red-200 bg-red-50 p-6">
                <div className="text-sm font-black text-red-700">
                  Unable to load orders
                </div>
                <div className="mt-1 text-xs text-red-600">
                  {ordersError}
                </div>
              </div>
            ) : orders.length === 0 ? (
              <div className="rounded-2xl border border-[#dce2d9] bg-[#f7f8f4] p-10 text-center">
                <div className="text-sm font-black text-[#243229]">
                  No orders yet
                </div>
                <div className="mt-2 text-xs leading-5 text-[#69756c]">
                  Browse the marketplace above and start your first order.
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                {/* Search by order number... input matching reference screenshot */}
                <div className="relative mb-5">
                  <SearchIcon className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[#7b867d]" />
                  <input
                    type="text"
                    value={orderSearchQuery}
                    onChange={(event) =>
                      setOrderSearchQuery(event.target.value)
                    }
                    placeholder="Search by order number..."
                    className="w-full rounded-full border border-[#dce2d9] bg-white py-3 pl-11 pr-4 text-xs font-medium text-[#17251b] placeholder-[#9aa39c] shadow-sm transition focus:border-[#17633a] focus:outline-none focus:ring-1 focus:ring-[#17633a] sm:text-sm"
                  />
                </div>

                {filteredOrderRenderList.length === 0 ? (
                  <div className="rounded-3xl border border-[#dce2d9] bg-white p-8 text-center shadow-sm">
                    <div className="text-sm font-bold text-[#17251b]">
                      No orders match &ldquo;{orderSearchQuery}&rdquo;
                    </div>
                    <div className="mt-1 text-xs text-[#7b867d]">
                      Try searching with another order number or product name.
                    </div>
                  </div>
                ) : (
                  filteredOrderRenderList.map((group) => (
                    <div key={group.key} className="space-y-4">
                      {group.orders.length > 1 ? (
                        <div className="rounded-2xl border border-[#cfe0cf] bg-[#eaf3ec] px-4 py-3 text-xs font-black text-[#17633a]">
                          Multi-supplier checkout • {group.orders.length} orders
                          • combined R
                          {group.orders
                            .reduce((sum, o) => sum + Number(o.total), 0)
                            .toFixed(2)}
                        </div>
                      ) : null}

                      {group.orders.map((order) => {
                        const statusStyle = getOrderStatusStyle(order.status);
                        const isCancelled = order.status === "CANCELLED";

                        return (
                          <article
                            key={order.id}
                            className="rounded-2xl border border-[#dce2d9] bg-white p-4 shadow-sm transition hover:shadow-md sm:p-5"
                          >
                            {/* Top Row: Store/Product title + Status */}
                            <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
                              <div className="min-w-0 flex-1">
                                <h3 className="truncate text-base font-black text-[#17251b] sm:text-lg">
                                  {order.items[0]?.productName
                                    ? order.items.length === 1
                                      ? order.items[0].productName
                                      : `${order.items[0].productName} · +${order.items.length - 1} more`
                                    : "BonAgri Order"}
                                </h3>
                                <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-[#7b867d]">
                                  <span className="font-semibold text-[#5d695f]">
                                    #{order.orderNumber}
                                  </span>
                                  <span>·</span>
                                  <span>{formatOrderDate(order.createdAt)}</span>
                                </div>
                              </div>

                              <div className="ml-auto flex shrink-0 flex-col items-end text-right">
                                <div
                                  className={`text-sm font-bold tracking-tight ${statusStyle.colorClass}`}
                                >
                                  {statusStyle.label}
                                </div>

                                {order.payment ? (
                                  <span
                                    className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[9px] font-black uppercase tracking-wide ${
                                      order.payment.status === "PAID"
                                        ? "bg-[#e5f1e4] text-[#17633a]"
                                        : order.payment.status === "FAILED"
                                          ? "bg-red-100 text-red-700"
                                          : "bg-amber-100 text-amber-700"
                                    }`}
                                  >
                                    {order.payment.status === "PAID"
                                      ? "Paid via EFT"
                                      : order.payment.status === "FAILED"
                                        ? "EFT ref rejected"
                                        : "EFT awaiting check"}
                                  </span>
                                ) : null}

                                {order.delivery &&
                                ["PICKED_UP", "IN_TRANSIT", "FAILED"].includes(
                                  order.delivery.status,
                                ) ? (
                                  <span
                                    className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[9px] font-black uppercase tracking-wide ${
                                      order.delivery.status === "FAILED"
                                        ? "bg-red-100 text-red-700"
                                        : order.delivery.status === "PICKED_UP"
                                          ? "bg-sky-100 text-sky-700"
                                          : "bg-indigo-100 text-indigo-700"
                                    }`}
                                  >
                                    {order.delivery.status === "PICKED_UP"
                                      ? "Picked up"
                                      : order.delivery.status === "IN_TRANSIT"
                                        ? "In transit"
                                        : "Delivery failed"}
                                  </span>
                                ) : null}
                              </div>
                            </div>

                            {/* Middle Row: Items summary & destination */}
                            <div className="mt-2.5 text-xs sm:text-sm text-[#5d695f]">
                              {order.items
                                .map(
                                  (item) =>
                                    `${item.productName}${item.quantity > 1 ? ` (${item.quantity}x)` : ""}`,
                                )
                                .join(" · ")}
                              {order.deliveryAddress?.city
                                ? ` · ${order.deliveryAddress.city}`
                                : ""}
                            </div>

                            {order.delivery?.driverName ? (
                              <div className="mt-2 rounded-xl bg-[#f4f7f3] px-3 py-1.5 text-xs text-[#17633a]">
                                <span className="font-bold">
                                  {order.delivery.status === "DELIVERED"
                                    ? "Delivered"
                                    : "Out for delivery"}
                                </span>
                                {" · Driver "}
                                {order.delivery.driverName}
                                {order.delivery.trackingNumber
                                  ? ` · Tracking ${order.delivery.trackingNumber}`
                                  : ""}
                              </div>
                            ) : null}

                            {order.delivery?.status === "FAILED" ? (
                              <div className="mt-2 rounded-xl bg-red-50 px-3 py-1.5 text-xs text-red-700">
                                <span className="font-bold">Delivery failed</span>
                                {order.delivery.failedReason
                                  ? ` · ${order.delivery.failedReason}`
                                  : ""}
                              </div>
                            ) : null}

                            {/* Dashed divider line from reference layout */}
                            <div className="my-3.5 border-t border-dashed border-[#e4eae0]" />

                            {/* Bottom Row: Total / Refunded on left, Action buttons on right */}
                            <div className="flex flex-wrap items-center justify-between gap-3">
                              <div className="flex items-baseline gap-1.5 text-xs">
                                <span className="font-semibold text-[#7b867d]">
                                  {isCancelled ? "Refunded" : "Total"}
                                </span>
                                <span className="text-base sm:text-lg font-black text-[#17251b]">
                                  R{order.total}
                                </span>
                              </div>

                              <div className="flex flex-wrap items-center gap-2">
                                <Link
                                  href={`/orders/${order.id}/invoice`}
                                  className="rounded-full bg-[#f4f6f2] px-4 py-2 text-xs font-bold text-[#344238] shadow-sm transition hover:bg-[#e8ece5] active:scale-[0.98]"
                                >
                                  Receipt
                                </Link>

                                <Link
                                  href={`/orders/${order.id}`}
                                  className="rounded-full bg-[#17633a] px-4 py-2 text-xs font-black text-white shadow-sm transition hover:bg-[#0f4d2b] active:scale-[0.98]"
                                >
                                  View Order
                                </Link>

                                {order.status === "PENDING" &&
                                (!order.payment ||
                                  order.payment.status === "FAILED") ? (
                                  paymentEntryOrderId === order.id ? (
                                    <div className="flex flex-wrap items-center gap-1.5">
                                      <input
                                        type="text"
                                        value={paymentRef}
                                        onChange={(event) =>
                                          setPaymentRef(event.target.value)
                                        }
                                        placeholder="EFT reference"
                                        className="w-36 rounded-full border border-[#dce2d9] bg-white px-3.5 py-2 text-xs text-slate-900 outline-none transition focus:border-[#17633a] focus:ring-2 focus:ring-[#e5f1e4]"
                                      />
                                      <button
                                        type="button"
                                        disabled={
                                          recordingPaymentId === order.id
                                        }
                                        onClick={() =>
                                          void recordPayment(order.id)
                                        }
                                        className="rounded-full bg-[#17633a] px-3.5 py-2 text-xs font-black text-white shadow-sm transition hover:bg-[#0f4d2b] disabled:opacity-50"
                                      >
                                        {recordingPaymentId === order.id
                                          ? "..."
                                          : "Submit"}
                                      </button>
                                      <button
                                        type="button"
                                        disabled={
                                          recordingPaymentId === order.id
                                        }
                                        onClick={() => {
                                          setPaymentEntryOrderId(null);
                                          setPaymentRef("");
                                          setOrderActionError("");
                                        }}
                                        className="rounded-full border border-[#dce2d9] bg-white px-3 py-2 text-xs font-bold text-[#5d695f] shadow-sm transition hover:bg-[#f4f6f2]"
                                      >
                                        Cancel
                                      </button>
                                    </div>
                                  ) : (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setPaymentEntryOrderId(order.id);
                                        setPaymentRef("");
                                        setOrderActionError("");
                                      }}
                                      className="rounded-full border border-[#bcd6c0] bg-white px-3.5 py-2 text-xs font-black text-[#17633a] shadow-sm transition hover:bg-[#eaf3ec] active:scale-[0.98]"
                                    >
                                      {order.payment?.status === "FAILED"
                                        ? "Re-record EFT"
                                        : "Pay EFT"}
                                    </button>
                                  )
                                ) : null}

                                {order.status === "PENDING" ? (
                                  <button
                                    type="button"
                                    disabled={cancellingOrderId === order.id}
                                    onClick={() =>
                                      void cancelOrder(
                                        order.id,
                                        order.orderNumber,
                                      )
                                    }
                                    className="rounded-full border border-red-200 bg-white px-3.5 py-2 text-xs font-black text-red-600 shadow-sm transition hover:bg-red-50 active:scale-[0.98] disabled:opacity-50"
                                  >
                                    {cancellingOrderId === order.id
                                      ? "Cancelling..."
                                      : "Cancel"}
                                  </button>
                                ) : null}
                              </div>
                            </div>
                          </article>
                        );
                      })}
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        </div>
      </section>
      ) : null}

      {/* Buyer shell: the footer lives inside the scrollable shopping column,
          so it still ends the listings on desktop exactly as it ended the
          page before the column became the scroll region. */}
      {appMode ? (
        <SiteFooter view={view} selectedProduct={selectedProduct} role={currentUser?.role} />
      ) : null}
        </div>
      </div>

      {/* Marketing close-out (how it works + supplier CTA) — guests only. */}
      {!appMode ? (
        <>
      <section id="how-it-works" className="bg-[#163b25] text-white">
        <div className="mx-auto max-w-7xl px-6 py-16">
          <div className="max-w-2xl">
            <div className="text-xs font-black uppercase tracking-[0.2em] text-[#b7d0b9]">
              How BonAgri works
            </div>
            <h2 className="mt-3 text-3xl font-black tracking-tight md:text-4xl">
              From agricultural supply to market.
            </h2>
          </div>

          <div className="mt-12 grid gap-4 md:grid-cols-4">
            {workflow.map(([number, title, description]) => (
              <div
                key={number}
                className="rounded-2xl border border-white/10 bg-white/5 p-6"
              >
                <div className="text-xs font-black tracking-[0.2em] text-[#9fbea3]">
                  {number}
                </div>
                <h3 className="mt-8 text-xl font-black">{title}</h3>
                <p className="mt-3 text-sm leading-6 text-[#c5d3c7]">
                  {description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Supplier CTA */}
      <section id="suppliers" className="mx-auto max-w-7xl px-6 py-20">
        <div className="rounded-[2rem] border border-[#d7dfd4] bg-[#e9eee4] p-8 md:p-14">
          <div className="max-w-3xl">
            <div className="text-xs font-black uppercase tracking-[0.2em] text-[#17633a]">
              For farmers & suppliers
            </div>

            <h2 className="mt-4 text-3xl font-black tracking-tight md:text-5xl">
              List what you grow. Reach more buyers.
            </h2>

            <p className="mt-5 max-w-2xl leading-7 text-[#637067]">
              Build your supplier profile, publish available agricultural
              products and respond to commercial demand through BonAgri.
            </p>

            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link
                href="/apply"
                className="rounded-xl bg-[#17633a] px-6 py-3.5 text-sm font-black text-white hover:bg-[#0f4d2b]"
              >
                Become a supplier
              </Link>
              <a
                href="#how-it-works"
                className="rounded-xl border border-[#bfcabd] bg-white px-6 py-3.5 text-sm font-black text-[#344238]"
              >
                Learn more
              </a>
            </div>
          </div>
        </div>
      </section>
        </>
      ) : null}

      {/* Footer — guests keep it after the marketing close-out; the buyer
          shell renders it at the end of the scrollable column instead (see
          the column's closing tag below). */}
      {!appMode ? (
        <SiteFooter view={view} selectedProduct={selectedProduct} role={currentUser?.role} />
      ) : null}

      {appMode && !selectedProduct ? (
        <div className="lg:hidden">
          <TabBar
            view={view === "orders" ? "profile" : view}
            cartCount={cartCount}
            onNavigate={(nextView) => {
              if (
                sessionChecked &&
                !currentUser &&
                (nextView === "cart" || nextView === "profile")
              ) {
                promptSignIn(
                  nextView === "cart" ? "open your cart" : "view your profile",
                );
                return;
              }
              goTo(nextView);
            }}
          />
        </div>
      ) : null}

      {!appMode ? <GuestWalkthrough /> : null}

      {filterSheetOpen ? (
        <FilterSheet
          open
          filters={filters}
          facets={facets}
          categories={searchCategoryOptions}
          onApply={applyFilters}
          onClose={() => setFilterSheetOpen(false)}
        />
      ) : null}

      <SignInSheet
        open={authPromptAction !== null}
        action={authPromptAction}
        onClose={closeAuthPrompt}
      />

      {/* Quick-add confirmation (mobile grid) — real cart state only. */}
      {flash ? (
        <div
          role="status"
          className={`fixed inset-x-0 bottom-20 z-[65] mx-auto flex w-[calc(100%-2rem)] max-w-xs items-center justify-between gap-3 rounded-xl px-4 py-3 text-xs font-black shadow-2xl lg:bottom-6 ${
            flash.kind === "error"
              ? "bg-red-600 text-white"
              : "bg-[#17251b] text-white"
          }`}
        >
          <span className="min-w-0 truncate">{flash.message}</span>
          {flash.kind === "success" ? (
            <button
              type="button"
              onClick={() => goTo("cart")}
              className="shrink-0 text-[#8fe0a8] underline"
            >
              View cart
            </button>
          ) : null}
        </div>
      ) : null}
    </main>
  );
}
