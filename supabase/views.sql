-- =====================================================================
-- YARZ Supabase Views (replaces Google Sheets FILTER formulas)
-- Date: 2026-06-20
-- These views mirror the GAS DRAFT_VIEW, ARCHIVE_VIEW, WEBSITE_SYNC
-- so the existing _doSheetRead(range) API can be reproduced.
-- =====================================================================

-- WEBSITE_SYNC view (Active products, customer-facing subset of columns)
create or replace view website_sync_view as
select
  product         as "Product",
  image_1         as "Image1",
  image_2         as "Image2",
  image_3         as "Image3",
  video_url       as "Video",
  description     as "Description",
  category        as "Category",
  fabric          as "Fabric",
  badge           as "Badge",
  size_chart      as "SizeChart",
  delivery_days   as "DeliveryDays",
  regular         as "Regular",
  sale            as "Sale",
  disc_percent    as "Disc%",
  disc_type       as "DiscType",
  dhaka_delivery  as "Delivery(Dhaka)",
  outside_delivery as "Delivery(Outside)",
  greatest(stk_s - sold_s, 0) as "S_Left",
  greatest(stk_m - sold_m, 0) as "M_Left",
  greatest(stk_l - sold_l, 0) as "L_Left",
  greatest(stk_xl - sold_xl, 0) as "XL_Left",
  greatest(stk_xxl - sold_xxl, 0) as "XXL_Left",
  greatest(stk_3xl - sold_3xl, 0) as "3XL_Left",
  status          as "Status",
  image_4         as "Image4",
  image_5         as "Image5",
  image_6         as "Image6",
  coupon_active   as "CouponActive",
  coupon_code     as "CouponCode",
  coupon_disc_percent as "CouponDisc"
from inventory
where status = ''Active'' and product <> '''';

-- DRAFT_VIEW (Draft products only, admin sees)
create or replace view inventory_draft_view as
select
  row_number() over (order by product) as "#",
  product         as "Product",
  image_1         as "Image",
  category        as "Category",
  fabric          as "Fabric",
  badge           as "Badge",
  cost            as "Cost",
  regular         as "Regular",
  sale            as "Sale",
  tot_stock       as "Stock",
  tot_sold        as "Sold",
  remaining       as "Left",
  ''--''          as "Action"
from inventory
where status = ''Draft'' and product <> '''';

-- ARCHIVE_VIEW (Archived products only)
create or replace view inventory_archive_view as
select
  row_number() over (order by product) as "#",
  product         as "Product",
  image_1         as "Image",
  category        as "Category",
  fabric          as "Fabric",
  badge           as "Badge",
  cost            as "Cost",
  regular         as "Regular",
  sale            as "Sale",
  tot_stock       as "Stock",
  tot_sold        as "Sold",
  remaining       as "Left",
  ''--''          as "Action"
from inventory
where status = ''Archived'' and product <> '''';

-- PUBLIC_PRODUCTS view (used by frontend; subset of WEBSITE_SYNC + computed flags)
create or replace view public_products as
select *
from website_sync_view;

-- CUSTOMER_LTV view (aggregates orders + website_orders)
create or replace view customer_ltv_view as
select
  cust_phone as phone,
  max(cust_name) as name,
  count(*) as total_orders,
  coalesce(sum(total), 0) as total_spent,
  min(date) as first_order_at,
  max(date) as last_order_at
from (
  select cust_name, cust_phone, total, date from orders where cust_phone <> ''''
  union all
  select cust_name, cust_phone, total, date from website_orders where cust_phone <> ''''
) combined
group by cust_phone;

-- =====================================================================
-- END views.sql
-- =====================================================================
