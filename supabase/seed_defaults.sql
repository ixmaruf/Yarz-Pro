-- =====================================================================
-- YARZ Supabase Seed Defaults
-- Date: 2026-06-20
-- Populates: settings (defaults from _setupSettings), delivery_charges
-- =====================================================================

insert into settings (key, value, description) values
  (''Store Name'',          ''YARZ'',                                 ''sotorer nam''),
  (''Store Phone'',         '''',                                     ''phone number''),
  (''Store Email'',         '''',                                     ''email''),
  (''Store Address'',       '''',                                     ''thikana''),
  (''Currency Symbol'',     ''?'',                                    ''currency''),
  (''Link Facebook'',       ''https://www.facebook.com/Yarzbd'',      ''Footer/contact social link''),
  (''Link Instagram'',      ''https://www.instagram.com/yarz_bd'',    ''Footer/contact social link''),
  (''Link WhatsApp'',       ''https://wa.me/8801601743670'',          ''Footer/contact social link''),
  (''Link Messenger'',      ''https://m.me/Yarzbd'',                  ''Footer/contact social link + floating chat''),
  (''Link TikTok'',         ''https://tiktok.com/@yarzbd'',           ''Footer/contact social link''),
  (''Link YouTube'',        '''',                                     ''Optional footer/contact social link''),
  (''Custom Categories'',   ''Shirt,T-Shirt,Polo,Formal,Casual,Panjabi,Kurta,Pant,Formal Pant,Jeans,Chinos,Cargo Pant,Trouser,Hoodie,Sweater,Jacket,Blazer,Coat,Waistcoat,Tracksuit,Shorts,Three Quarter,Shoes,Sneakers,Sandals,Belt,Cap,Hat,Watch,Wallet,Sunglasses,Accessories,Other'', ''comma-separated''),
  (''Custom Fabrics'',      ''Oxford Cotton,Poplin Cotton,Premium Cotton,Cotton,China Fabric,Twill Cotton,Linen,Silk,Denim,Polyester,Rayon,Viscose,Chiffon,Georgette,Khadi,Jersey,Fleece,Wool,Corduroy,Satin,Velvet,Nylon,Spandex,Mixed,Other'', ''comma-separated''),
  (''Custom Badges'',       '',New Arrival,Hot Sale,Best Seller,Limited Edition,Trending,Premium,Sold Out Soon'', ''comma-separated''),
  (''GitHub Token'',        '''',                                     ''GitHub sync''),
  (''GitHub Repo'',         '''',                                     ''GitHub sync''),
  (''GitHub Branch'',       ''main'',                                 ''GitHub sync''),
  (''GitHub Path'',         ''data.json'',                            ''GitHub sync'')
on conflict (key) do nothing;

insert into delivery_charges (id, name, charge, active, sort_order) values
  (''inside_narayanganj'',  ''Inside Narayanganj'',  70,  true, 1),
  (''outside_narayanganj'', ''Outside Narayanganj'', 140, true, 2)
on conflict (id) do nothing;

-- Mark the secret keys as secret so they do NOT leak via anon reads
update settings set is_secret = true where key in (''GitHub Token'',''Steadfast API Key'',''Steadfast Secret Key'');
