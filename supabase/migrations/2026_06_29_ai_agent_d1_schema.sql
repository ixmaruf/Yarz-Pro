-- =====================================================================
-- YARZ AI Agent D1 Schema
-- Migration: 2026-06-29
--
-- Cloudflare D1 database for the YARZ multi-platform AI Agent:
--   * chat_history     - conversation memory per customer (last 20 msgs)
--   * customer_profile - saved customer info (name, phone, address, size)
--   * ai_settings      - active AI model, platform toggles, rate limits,
--                        handover keywords, delivery charges
--
-- Apply via: npx wrangler d1 execute yarz-ai-agent --file=this.sql
-- Or via Cloudflare dashboard SQL console.
-- =====================================================================

CREATE TABLE IF NOT EXISTS chat_history (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  sender_id       TEXT    NOT NULL,
  platform        TEXT    NOT NULL,
  role            TEXT    NOT NULL CHECK (role IN ('user','assistant','system')),
  message         TEXT    NOT NULL,
  image_url       TEXT,
  product_matched TEXT,
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_chat_history_sender ON chat_history(sender_id, created_at DESC);

CREATE TABLE IF NOT EXISTS customer_profile (
  sender_id     TEXT PRIMARY KEY,
  name          TEXT,
  phone         TEXT,
  address       TEXT,
  city          TEXT,
  size_pref     TEXT,
  last_order_at DATETIME,
  total_orders  INTEGER DEFAULT 0,
  last_seen     DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS ai_settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Seed default settings (overridable from admin panel + Telegram bot)
INSERT OR IGNORE INTO ai_settings(key, value) VALUES
  ('active_model',           'gemini'),
  ('platform_messenger',     'on'),
  ('platform_instagram',     'off'),
  ('platform_whatsapp',      'off'),
  ('platform_tiktok',        'off'),
  ('rate_limit_per_min',      '10'),
  ('handover_keywords',      'admin,owner,human,মালিক,এডমিন'),
  ('delivery_narayanganj_in', '80'),
  ('delivery_narayanganj_out','125'),
  ('telegram_bot_token',      ''),
  ('telegram_chat_id',        ''),
  ('meta_page_token',         ''),
  ('meta_page_id',            ''),
  ('meta_verify_token',       ''),
  ('gemini_api_key',          ''),
  ('minimax_api_key',          ''),
  ('kimi_api_key',            ''),
  ('deepseek_api_key',        ''),
  ('chatgpt_api_key',         ''),
  ('claude_api_key',          '');
