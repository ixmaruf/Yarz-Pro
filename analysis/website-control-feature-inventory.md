# Website Control — Feature Inventory (captured 2026-06-20)

## 9 Tabs (sidebar `Website Control`)
1. General Setup
2. Banners & Flash
3. Builder
4. Product Page
5. Cart & Checkout
6. Marketing
7. Branding & SEO
8. Extras (Premium)
9. Advanced (Royal)

---

## 1. General Setup
- `wc-store-status` (Maintenance Mode, off)
- `wc-b2b-mode` (B2B/Wholesale, off)
- `wc-currency` (BDT)
- `wc-language` (en/English)
- Holiday/Vacation Mode
  - `wc-holiday-mode` (on)
  - `wc-holiday-reason` (custom)
  - `wc-holiday-msg` = "Happy Holidays from YARZ!"
  - `wc-holiday-return-date` = 2026-12-31T00:00
- Global Announcement
  - `wc-announcement-active` (on)
  - `wc-announcement-text` = "Free shipping on orders over ৳2,000 in Narayanganj"
  - `wc-ann-bg` = #1a1a1a
  - `wc-ann-text` = #ffffff
- Bottom Showcase (2 Images)
  - `wc-popup-active` (on)
  - `wc-popup-img` (empty)
  - `wc-popup-link` (empty — placeholder says "image2.jpg" but it's a link)

## 2. Banners & Flash
- Flash Sale Timer
  - `wc-flash-date` = 2026-12-31T23:59
  - `wc-flash-title` = "Flash Sale"
- Hero Slider Banners ×5 (wc-btitle-1..5, wc-bimg-1..5, wc-blink-1..5, wc-btxtcolor-1..5 = #FFFFFF each)
  - All 5 banner titles/images/links EMPTY

## 3. Builder (Homepage Dynamic Builder)
- Up to 25 dynamic homepage sections
- Per section: SHOW toggle, Section Title, Category dropdown, Banner Image URL, Target Links (products) list
- "+ Add New Dynamic Section" button

## 4. Product Page (Product Page Optimization)
- `wc-quick-view` (on), `wc-stock-bar` (on), `wc-related-prod` (on), `wc-live-search` (on)
- `wc-hover-effect` (select, empty)
- `wc-add-cart-text` = "Add to Cart"
- `wc-max-qty` = 10
- `wc-exp-delivery` = "2-3 days inside Narayanganj, 3-5 days outside"

## 5. Cart & Checkout
- `wc-cart-drawer` (off), `wc-order-notes` (on), `wc-enable-cod` (on), `wc-freeship-advance` (off)
- `wc-checkout-mode` (select, empty)
- `wc-custom-field` (empty)
- Delivery Charge Manager
  - inside_narayanganj / Inside Narayanganj / 70
  - outside_narayanganj / Outside Narayanganj / 140
- `wc-free-ship-amt` = 2000
- `wc-min-order` = 0

## 6. Marketing & Engagement
- `wc-exit-popup` (on)
- `wc-loyalty` (off)
- `wc-trust-badges` (off)
- `wc-abandon-msg` = "You left items in your cart! Complete your order now."

## 7. Branding & SEO
- Theme & Global Branding
  - `wc-logo` (empty), `wc-font` = Inter, `wc-theme-color` = #1A202C, `wc-live-chat` (empty)
  - `wc-footer-text` = "© 2026 YARZ. All rights reserved."
- Social Links: `wc-link-fb/ig/wa/ms/tt/yt` (fb/ig/wa/ms/tt populated, yt empty)
- SEO & Analytics
  - `wc-meta-title` = "YARZ — Premium Clothing from Narayanganj"
  - `wc-meta-desc` = "Shop premium shirts, pants, hoodies and accessories. Free shipping in Narayanganj."
- Pixels: fb-pixel / fb-capi-token / ga4 / ig-pixel / tt-pixel / pin-pixel / snap-pixel / fb-capi-test-code / fb-capi-test-mode / fb-domain-verify / tt-token / tt-advertiser-id (all empty)
- Telegram Order Notification
  - `wc-tg-token` (empty), `wc-tg-chat` (empty)
- `wc-avg-order-value` = 800
- `wc-og-img` (empty), `wc-gsc-tag` (empty)
- `fb-feed-url-display` = https://script.google.com/macros/s/AKfycbzLs9KDameNALSxN4ntZXHKs-st2V-4gN5ITFL38UnqKFw_s2yXFPcmLFB4KXzIVs7K/exec?action=
- Pixel event gates: pix_net_* (6 networks all on), pix_evt_* (22 events, all on except order_delivered/cancelled/returned off)
- `wc-custom-css` (empty)

## 8. Extras (Premium)
- Full Theme Palette: 8 color pickers (primary #000, accent #dc2626, bg #fff, card #fff, text #1a1a1a, border #e5e5e5, link #1a1a1a, sale #dc2626, footer #f5f5f5)
- Typography: heading/body/bn font selectors (Inter / Inter / Hind Siliguri)
- Product Card Style: `wc-card-style` (empty), `wc-card-hover` = lift
- Sale Countdown Banner: wc-countdown-* (active on, end 2026-12-31T23:59, title "Flash Sale", bg #dc2626, text "Hurry! Limited time offer.")
- Free Shipping Bar: wc-freeship-* (active on, text "Free shipping on orders over ৳2,000 🚚", bg #16a34a, text #fff)
- Auto-Generated Sections: wc-bestseller-active (on, title "Best Sellers", count 8), wc-newarrival-active (on, days 30), wc-recently-viewed (on), wc-wishlist-active (on)
- Product Page Premium: wc-sticky-buy / wc-video-autoplay / wc-oos-hide / wc-quick-view-active / wc-size-oos-hide (all on)
- Size Visibility Control: wc-size-shirt-S/M/L/XL/XXL/3XL + wc-size-pant-28..38 (all on)
- Newsletter Popup with Discount: wc-newsletter-* (active on, title "Get 10% off your first order", code "WELCOME10", trigger "exit")
- Store Hours & Delivery Timing: wc-hours-active (on), open 09:00, close 21:00, msg "Open 9 AM - 9 PM every day"
- FAQ Section (Footer): wc-faq-active (on) + empty Q&A list
- Customer Testimonials: wc-reviews-active (on) + empty review list (rating default 5)
- Floating Chat Button Position: wc-float-pos (bottom-right), wc-float-offset (20)
- Promo Popup Slots (3 slots, all empty: enable, title, body, start, end, discount, button text, button link)

## 9. Advanced (Royal)
- Royal Announcement Marquee: wc-marquee-* (active on, text "YARZ — Free shipping on orders over ৳2,000", bg #000, text #fff)
- Product Page Trust Badges: wc-trust-strip-active (on), 4 trust items (truck/Free shipping, shield/Secure checkout, rotate/Easy returns, check/Quality guaranteed)
- Royal Card Frame: wc-royal-frame-active (on), accent #d4af37 (gold)
- Editorial Story Section: wc-editorial-* (active on, img empty, title "Our Story", body "Crafted with care, made to last.", CTA "Shop Now" → /category/all)
- Instagram-Style Gallery: wc-iggrid-* (active on, title "Follow us on Instagram", 6 image slots empty, link https://instagram.com/yarz_bd)
- Men's Accessories Showcase: wc-accessories-* (active on, title "Accessories", subtitle "Complete your look", banner empty)

---

## Cross-check vs Supabase `website_settings` keys (188 stored)
Need to compare admin form IDs (wc-*) with actual `key` column values in `website_settings` table.