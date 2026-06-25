# app.js — Full Audit Summary

**File:** `C:\Users\maruf\Downloads\YARZ WEB SITE\js\app.js`
**Size:** ~545 KB
**Lines:** 9,632
**Type:** Main SPA Controller (customer-facing website)

---

## Architecture

The file is a single IIFE (Immediately Invoked Function Expression) assigned to `window.YARZ`. It returns a public API object with ~50 methods. Initialized via `document.addEventListener('DOMContentLoaded', YARZ.init)`.

### State (lines ~5-150)
- Central `state` object holds: products, cart, categories, currentView, currentProduct, storeInfo, controls, user, appliedCoupon, etc.
- Global utility functions: `$`, `$$`, `showToast`, `formatPrice`, `escHtml`, `slugify`, `_randHex`

### Helper Modules/Systems
| System | Lines | Description |
|--------|-------|-------------|
| Icon Library (ICONS) | ~150-220 | SVG icon set for UI elements |
| Smart Account Manager | ~220-320 | localStorage save/load user + orders with TTL |
| Error Buffer | ~320-350 | Captures runtime errors for debugging |
| Delivery Locations | ~350-450 | Parses zone config from storeInfo |
| Product/Category Helpers | ~450-600 | findProductBySlug, category matching, accessories |
| Size Management | ~600-700 | 6 size systems: per-product type override, admin visibility |
| Hero Slider | ~700-900 | Auto-advancing + dot navigation |
| Mobile Menu | ~900-980 | Hamburger menu toggle |
| Product Rendering | ~980-1450 | renderProducts, renderProductCard with grid |
| Categories | ~1450-1600 | renderCategories with count badges |
| Dynamic Sections | ~1600-1950 | Featured collections from admin settings |
| Wishlist | ~1950-2100 | localStorage-based wishlist |
| Accessories | ~2100-2200 | Dedicated accessories showcase |
| Advanced Controls (Extras) | ~2200-2800 | Theme palette, card style, free-ship bar, countdown, marquee |
| Image Helpers | ~2800-2950 | getImgSrc, image-turbo integration |
| Turbo First Paint | ~2950-3170 | Fast path: renders from CF Worker edge cache |
| Collection View | ~3170-3265 | Section-based product collections |
| Filter System | ~3265-3495 | Size + sort filters with drawer |
| Product Detail | ~3495-4060 | Full PDP: gallery, video, coupon ticket, sizes, description toggle |
| Live Stock | ~3500-3635 | Silent background stock polling via CF Worker |
| Cart | ~4319-4585 | Add/remove/update cart, render drawer with free-ship banner |
| Buy Now | ~4586-4675 | Express purchase with cart snapshot revert |
| Checkout | ~4676-5430 | Full checkout form, COD/modal, payment zones, coupon, free-ship advance |
| Order Submission | ~5467-6137 | Validation (Fortress, Shield, honeypot, phone, rate-limit, blacklist) + optimistic submit |
| Order Tracking | ~6390-6890 | Phone-based search, API+local merge, 14 statuses with Bengali labels |
| Cancel Order | ~6892-6991 | Server-side + localStorage delete with status guard |
| Browser Chrome Sync | ~7061-7120 | theme-color meta sync for address bar |
| Payment Info | ~7122-7257 | bKash/Nagad instruction boxes with copy buttons |
| SEO/Tracking Injection | ~7263-7480 | Meta tags, FB/GA4/TT/Snap/Pinterest pixels, custom CSS |
| Hero Banners | ~7482-7642 | Banner rendering with srcset/LCP optimization |
| Popstate Handler | ~7655-7889 | Browser back/forward + stale-data refresh (bfcache, visibility, focus) |
| Init | ~7892-8920 | Main init: turbo first paint, global controls, product loading, hash routing |
| Maintenance Mode | ~8922-8955 | Full-page overlay |
| Holiday Mode | ~8964-9362 | Premium vacation overlay with countdown, 6 reason presets |
| Social Icons | ~9364-9474 | 7 platforms with brand-color SVGs |
| Live Chat | ~9476-9555 | WhatsApp + Messenger floating buttons |

---

## Key Features & Versions
- v17.5: Focus trap (WCAG), shape-validated pending sync (cap 50, 30-day TTL)
- v17.1: Browser chrome color sync
- v17.0: Announcement bar → theme-color integration
- v16.13: "You May Also Like" — same-category products only
- v16.12: Strict session cache (no background refresh)
- v16.11: Admin-deleted order detection (2min-90day window)
- v16.9: Free shipping zone cards show "FREE"
- v16.8: advanceApplied as single source of truth
- v16.6: Payment amount text — 3 accurate delivery states
- v16.5: Auto-fill disabled, 90-day order display, 3 recent orders in cart
- v16.4: Coupon per-product, wishlist deep-link, 4-stage order timeline
- v16.3: Accessories showcase, search/related exclude accessories
- v16.2: Per-product Size Type override for pant detection
- v16.1: ONE_SIZE system for sizeless products (caps/watches)
- v16: Buy Now revert, admin per-size visibility, zone cards, Extras tab batch
- v15.96: Duplicate-in-cart guard for Buy Now
- v15.95: Admin-deleted order detection, buy-now revert fix
- v15.93: Place Order truck animation, premium order-summary with thumbnails
- v15.92: Coupon canonicalization (lowercase → proper case), Hidden mode
- v15.89: YARZ animated brand mark preservation
- v15.85: Brand-color wordmark badges for bKash/Nagad
- v15.77: Generic copyToClipboard helper, pay-number copy buttons
- v15.74: Holiday/vacation mode with 6 presets + countdown
- v15.58: Double-popup fix, site brand palette for modals
- v15.52: ?collection=N query param, slug extraction fix
- v15.49: Free-ship advance (₹100 security)
- v15.47: Blank-screen fixes for deep-link errors
- v15.45: Cart qty capped at stock
- v15.44: InitiateCheckout deduplication
- v15.42: Free-ship savings>0 gate removed
- v15.41: Free-ship milestone banner
- v15.40: Max qty hint
- v15.39: switchImage critical fix (remove srcset before changing src)
- v15.36: LCP optimizations (fetchpriority, async decode, responsive srcset)
- v15.35: Double-click guard, confirm modal reset
- v15.34: SWR store_info background refresh
- v15.32: Controls refresh on tab return
- v15.31: ReferenceError fix (orderNotes read from DOM)
- v15.30: Announcement bar CSS variables
- v15.27: Responsive srcset for PDP main image
- v15.13: Fullwidth banner CLS fix
- v15.7: GA4/pixel master toggle, subtotal for FB ROAS
- v15.6: cartDrawer toggle, liveSearch toggle, relatedProd toggle
- v15.5: v17.17 cart dedup → renamed to v15.5
- v14.5: Chrome → theme-color sync
- v14.2: Coupon ticket redesign
- v13.2: Payment method → pixel signal
- v13.1: requestIdleCallback for SEO JSON-LD
- v13.0: Hero banner URL cache for preload
- v12.1: has-saved-announcement, bfcache refresh
- v12.0: body.has-announcement class
- v11.8: Hide OOS per size, trust badge strip, Quick View
- v11.7: CAPI matching (fbp/fbc/ttp), AddPaymentInfo dedup
- v11.6: Combined notes field (customer instructions first)
- v11.3: Full theme palette
- v11: Per-banner text color, promo popups
- v10.9: Cross-device order sync (phone-based)
- v10.8: Smart Account Manager, universal coupon copy
- v10.7: Smart image switching with preload
- v10.6: Optimistic 0ms checkout
- v10.5: Pending order retry (5 attempts, 30s interval)
- v10.4: Anti-jitter skeleton timer
- v10.2: Pixel init from storeInfo
- v10.1: Unified cartItems payload
- v10.0: Explicit TrxID

---

## Security Architecture
- **Fortress** (v1.0): Device fingerprint + risk scoring
- **Shield** (v5.0): Anti-fraud validation
- **Honeypot**: Hidden field catches bots
- **Timing Guard**: <8s checkout → block
- **Rate Limiting**: 30s between orders
- **Duplicate Detection**: Same phone+cart within 30min
- **Phone Blacklist**: Admin-managed blocked phones
- **COD Guard**: Server-side recheck before COD submission
- **Buy Now Snapshot**: Cart reverts on abandonment

---

## API Integration
- `YARZ_API` (from api.js): products, categories, storeInfo, globalControls, orders, stock
- Primary: Supabase (via supabase-adapter-v2.js)
- Fallback: Cloudflare Worker → GAS passthrough
- Edge: CF Worker cache with 60s SWR revalidation

---

## Major Bugs Fixed (in this file)
1. v15.31: ReferenceError — orderNotes/customField read from sibling scope
2. v15.39: switchImage — srcset not removed before setting src
3. v15.47: Blank screen on deep-link errors
4. v15.92: Coupon lowercase → proper case canonicalization
5. v15.95: Admin-deleted order not detected (phost status)
6. v16.4: Coupon discount applied to whole subtotal instead of matching items
7. v16.11: Deleted order detection race condition fix

---

## Size & Complexity
- 8 anti-fraud layers in submitOrder
- 15+ rendering systems (products, categories, sections, wishlist, etc.)
- 6 pixel platforms (FB, GA4, TT, Snap, Pinterest, IG)
- 5+ localStorage persistence layers
- 60+ admin controls consumed
- 0 external runtime dependencies (pixel scripts injected dynamically)
