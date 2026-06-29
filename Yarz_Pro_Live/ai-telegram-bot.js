/**
 * =====================================================================
 * YARZ AI Telegram Bot — Command Handler Module
 * Date: 2026-06-30
 *
 * Owner-only command interface for the "YARZ Orders Bot"
 * (username: yarzclothing_v2_bot). Lets the owner control the AI Agent
 * directly from Telegram: switch models, toggle platforms, view orders,
 * reply to handovers, broadcast announcements.
 *
 * Owner chat_id: 8370659578  (configured via env.TELEGRAM_CHAT_ID)
 *
 * Designed for a Cloudflare Worker (or any ES-module runtime).
 *
 * Required environment variables:
 *   TELEGRAM_BOT_TOKEN   Bot token issued by @BotFather
 *   TELEGRAM_CHAT_ID     Owner's numeric chat id (string form accepted)
 *   WORKER_URL           Base URL of the agent worker (no trailing /)
 *
 * Worker integration (worker-supabase.js):
 *   case "/telegram/webhook": return await handleTelegramWebhook(request);
 * =====================================================================
 */

// ---------------------------------------------------------------------------
// 1. Constants
// ---------------------------------------------------------------------------

/** Allowed active AI models. Anything else returns an error to the owner. */
const VALID_MODELS = Object.freeze(['gemini', 'minimax', 'kimi', 'deepseek', 'chatgpt', 'claude']);

/** Allowed platforms for /toggle_* commands. */
const VALID_PLATFORMS = Object.freeze(['messenger', 'instagram', 'whatsapp', 'tiktok']);

/** Platform → emoji map used in handover / order notifications. */
const PLATFORM_EMOJI = Object.freeze({
  messenger: '📘',
  instagram: '📸',
  whatsapp:  '💬',
  tiktok:    '🎵'
});

/**
 * `env` is injected by the worker runtime (Cloudflare Workers pass it via
 * the module-level `env` parameter). For local testing or unit tests, you
 * may also override it directly:
 *
 *     import { handleTelegramWebhook } from './ai-telegram-bot.js';
 *     globalThis.env = { TELEGRAM_BOT_TOKEN: '...', TELEGRAM_CHAT_ID: '...', WORKER_URL: '...' };
 */
let env = globalThis.env || {};

/**
 * Override the environment reference. Useful for tests where `globalThis.env`
 * is not populated by a worker runtime.
 *
 * @param {object} newEnv  Object with TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, WORKER_URL.
 */
function setEnv(newEnv) {
  env = newEnv || {};
}

// ---------------------------------------------------------------------------
// 2. Main Webhook Handler
// ---------------------------------------------------------------------------

/**
 * Handles incoming Telegram webhook updates.
 * Routes commands to appropriate handlers. Only responds to messages from
 * the owner chat_id (security).
 *
 * @param {object} update  Raw Telegram update object from the webhook.
 * @returns {Promise<object|null>}  Telegram API response, or null if ignored.
 */
async function handleTelegramWebhook(update) {
  try {
    // Extract the message payload. Ignore edited messages, channel posts, etc.
    const message = update && update.message;
    if (!message || !message.text) return null;

    const chatId = String(message.chat.id);
    const ownerChatId = String(env.TELEGRAM_CHAT_ID || '');

    // Security: silently ignore any non-owner messages.
    if (!ownerChatId || chatId !== ownerChatId) {
      return null;
    }

    const text = String(message.text).trim();
    if (!text.startsWith('/')) {
      // Free-text from the owner — echo back the help command so they
      // can discover the bot's capabilities without typing /help.
      return sendHelp(chatId);
    }

    const parts = text.split(/\s+/);
    const command = parts[0];
    const args = parts.slice(1);

    switch (true) {
      case command === '/start':
        return sendWelcome(chatId);

      case command === '/status':
        return sendStatus(chatId);

      case command.startsWith('/model_'):
        return switchModel(chatId, command.replace('/model_', ''));

      case command.startsWith('/toggle_'):
        return togglePlatform(chatId, command.replace('/toggle_', ''));

      case command === '/orders':
        return showOrders(chatId);

      case command === '/conversations':
        return showConversations(chatId);

      case command === '/handover':
        return handleHandoverReply(chatId, args);

      case command === '/broadcast':
        return broadcastMessage(chatId, args.join(' '));

      case command === '/help':
        return sendHelp(chatId);

      default:
        return sendUnknownCommand(chatId);
    }
  } catch (err) {
    // Never let an uncaught exception crash the worker.
    console.error('[telegram-webhook] error:', err && err.message ? err.message : err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// 3. Individual Command Handlers
// ---------------------------------------------------------------------------

/**
 * /start — sends a bilingual welcome message listing bot capabilities.
 *
 * @param {string} chatId  Owner's chat id.
 * @returns {Promise<object>}
 */
async function sendWelcome(chatId) {
  const text =
`🤖 *YARZ AI Agent Control*

আসসালামু আলাইকুম! আমি আপনার AI Agent control bot।

📊 *স্ট্যাটাস দেখুন:* /status
🤖 *AI মডেল বদলান:* /model_gemini, /model_minimax, /model_kimi, /model_deepseek, /model_chatgpt, /model_claude
📱 *প্ল্যাটফর্ম চালু/বন্ধ:* /toggle_messenger, /toggle_instagram, /toggle_whatsapp, /toggle_tiktok
📦 *সাম্প্রতিক অর্ডার:* /orders
💬 *অ্যাক্টিভ কথোপকথন:* /conversations
🤝 *হ্যান্ডওভার রিপ্লাই:* /handover <sender_id> <message>
📢 *সবার কাছে পাঠান:* /broadcast <message>
❓ *সব কমান্ড:* /help`;

  return sendTelegramMessage(chatId, text);
}

/**
 * /status — fetches current agent settings + today's stats and renders them.
 *
 * @param {string} chatId
 * @returns {Promise<object>}
 */
async function sendStatus(chatId) {
  try {
    const [settings, stats] = await Promise.all([
      fetchWorkerSettings(),
      fetchWorkerStats()
    ]);

    // Defensive defaults so a partial response never throws here.
    const platforms = settings.platforms || {};
    const handover  = Array.isArray(settings.handover_keywords) ? settings.handover_keywords : [];
    const delivery  = settings.delivery || { narayanganj_in: 80, narayanganj_out: 125 };
    const rateLimit = settings.rate_limit_per_min != null ? settings.rate_limit_per_min : '?';

    const text =
`📊 *AI Agent Status*

🤖 *Active Model:* ${settings.active_model || 'unknown'}
📱 *Platforms:*
  • Messenger: ${platforms.messenger ? '✅ ON' : '❌ OFF'}
  • Instagram: ${platforms.instagram ? '✅ ON' : '❌ OFF'}
  • WhatsApp:  ${platforms.whatsapp  ? '✅ ON' : '❌ OFF'}
  • TikTok:    ${platforms.tiktok    ? '✅ ON' : '❌ OFF'}

⏱ *Rate Limit:* ${rateLimit} msg/min
🤝 *Handover Keywords:* ${handover.length ? handover.join(', ') : '—'}
🚚 *Delivery:* Inside ৳${delivery.narayanganj_in} / Outside ৳${delivery.narayanganj_out}

📈 *Today's Stats:*
  • Messages: ${stats.messages_today != null ? stats.messages_today : 0}
  • Active Chats: ${stats.active_chats != null ? stats.active_chats : 0}
  • Orders Placed: ${stats.orders_today != null ? stats.orders_today : 0}
  • Handovers: ${stats.handovers_today != null ? stats.handovers_today : 0}`;

    return sendTelegramMessage(chatId, text);
  } catch (err) {
    return sendTelegramMessage(
      chatId,
      `❌ Status fetch failed: ${err && err.message ? err.message : 'unknown error'}`
    );
  }
}

/**
 * /model_<name> — switches the active AI model.
 *
 * @param {string} chatId
 * @param {string} modelName  One of VALID_MODELS.
 * @returns {Promise<object>}
 */
async function switchModel(chatId, modelName) {
  const name = String(modelName || '').toLowerCase();
  if (!VALID_MODELS.includes(name)) {
    return sendTelegramMessage(
      chatId,
      `❌ Invalid model: \`${modelName}\`. Valid: ${VALID_MODELS.join(', ')}`
    );
  }

  try {
    const result = await updateWorkerSettings({ active_model: name });
    if (result && result.success) {
      return sendTelegramMessage(chatId, `✅ Active model switched to *${name}*`);
    }
    return sendTelegramMessage(
      chatId,
      `❌ Failed to switch model: ${(result && result.error) || 'unknown error'}`
    );
  } catch (err) {
    return sendTelegramMessage(
      chatId,
      `❌ Failed: ${err && err.message ? err.message : 'unknown error'}`
    );
  }
}

/**
 * /toggle_<platform> — toggles a platform's on/off state.
 *
 * @param {string} chatId
 * @param {string} platformName  One of VALID_PLATFORMS.
 * @returns {Promise<object>}
 */
async function togglePlatform(chatId, platformName) {
  const platform = String(platformName || '').toLowerCase();
  if (!VALID_PLATFORMS.includes(platform)) {
    return sendTelegramMessage(
      chatId,
      `❌ Invalid platform: \`${platformName}\`. Valid: ${VALID_PLATFORMS.join(', ')}`
    );
  }

  try {
    // Worker interprets the special string 'toggle' as "flip the boolean".
    const result = await updateWorkerSettings({ [`platform_${platform}`]: 'toggle' });
    if (result && result.success) {
      const newState = result.platforms && result.platforms[platform];
      const label = newState === true ? 'ON ✅' : newState === false ? 'OFF ❌' : 'toggled';
      return sendTelegramMessage(chatId, `✅ *${platform}* is now ${label}`);
    }
    return sendTelegramMessage(
      chatId,
      `❌ Failed: ${(result && result.error) || 'unknown error'}`
    );
  } catch (err) {
    return sendTelegramMessage(
      chatId,
      `❌ Failed: ${err && err.message ? err.message : 'unknown error'}`
    );
  }
}

/**
 * /orders — fetches the 5 most recent orders and renders a compact list.
 *
 * @param {string} chatId
 * @returns {Promise<object>}
 */
async function showOrders(chatId) {
  try {
    const orders = await fetchWorkerOrders();
    if (!orders || orders.length === 0) {
      return sendTelegramMessage(chatId, '📦 *Recent Orders:*\n\n_No orders yet._');
    }

    const lines = orders.map(o => {
      const id      = o.id != null ? o.id : '?';
      const product = o.product || 'Unknown';
      const size    = o.size || '-';
      const total   = o.total != null ? o.total : '?';
      const name    = o.name || 'Unknown';
      const phone   = o.phone || '-';
      const address = o.address || '-';
      return `• #${id} — ${product} (${size}) — ৳${total}\n  👤 ${name} | 📞 ${phone}\n  📍 ${address}`;
    });

    const text = `📦 *Recent Orders:*\n\n${lines.join('\n\n')}`;
    return sendTelegramMessage(chatId, text);
  } catch (err) {
    return sendTelegramMessage(
      chatId,
      `❌ Failed to fetch orders: ${err && err.message ? err.message : 'unknown error'}`
    );
  }
}

/**
 * /conversations — shows the current number of active customer conversations.
 *
 * @param {string} chatId
 * @returns {Promise<object>}
 */
async function showConversations(chatId) {
  try {
    const count = await fetchWorkerConversationCount();
    return sendTelegramMessage(chatId, `💬 Active Conversations: *${count}*`);
  } catch (err) {
    return sendTelegramMessage(
      chatId,
      `❌ Failed: ${err && err.message ? err.message : 'unknown error'}`
    );
  }
}

/**
 * /handover <sender_id> <message> — owner replies to a customer that the
 * agent has escalated to the owner. The worker routes the reply back to
 * the platform the customer originally messaged on.
 *
 * @param {string} chatId
 * @param {string[]} args  First element = sender_id, rest joined = message.
 * @returns {Promise<object>}
 */
async function handleHandoverReply(chatId, args) {
  const senderId = args && args[0];
  const message  = args && args.length > 1 ? args.slice(1).join(' ') : '';

  if (!senderId || !message) {
    return sendTelegramMessage(
      chatId,
      '❌ Format: `/handover <sender_id> <message>`\n\nExample: `/handover 12345 আপনার অর্ডার কনফার্ম হয়েছে`'
    );
  }

  try {
    const result = await sendHandoverReply(senderId, message);
    if (result && result.success) {
      return sendTelegramMessage(chatId, `✅ Reply sent to \`${senderId}\``);
    }
    return sendTelegramMessage(
      chatId,
      `❌ Failed to send reply: ${(result && result.error) || 'unknown error'}`
    );
  } catch (err) {
    return sendTelegramMessage(
      chatId,
      `❌ Failed: ${err && err.message ? err.message : 'unknown error'}`
    );
  }
}

/**
 * /broadcast <message> — sends a message to every active conversation
 * across all platforms. Returns the count of conversations reached.
 *
 * @param {string} chatId
 * @param {string} message
 * @returns {Promise<object>}
 */
async function broadcastMessage(chatId, message) {
  if (!message || !message.trim()) {
    return sendTelegramMessage(
      chatId,
      '❌ Format: `/broadcast <message>`\n\nExample: `/broadcast সাইট মেইনটেনেন্সের জন্য আজ রাত ১২টায় বন্ধ থাকবে`'
    );
  }

  try {
    const result = await broadcastToAll(message);
    const count = (result && result.count != null) ? result.count : 0;
    return sendTelegramMessage(chatId, `📢 Broadcast sent to *${count}* conversation(s)`);
  } catch (err) {
    return sendTelegramMessage(
      chatId,
      `❌ Failed: ${err && err.message ? err.message : 'unknown error'}`
    );
  }
}

/**
 * /help — lists every available command with a one-line description.
 *
 * @param {string} chatId
 * @returns {Promise<object>}
 */
async function sendHelp(chatId) {
  const text =
`❓ *Available Commands:*

*Status & Info*
/status — Show AI agent status (model, platforms, stats)
/orders — Recent 5 orders
/conversations — Active conversation count

*Switch AI Model*
/model_gemini — Switch to Gemini
/model_minimax — Switch to minimax
/model_kimi — Switch to Kimi
/model_deepseek — Switch to DeepSeek
/model_chatgpt — Switch to ChatGPT
/model_claude — Switch to Claude

*Toggle Platforms*
/toggle_messenger — Toggle Messenger
/toggle_instagram — Toggle Instagram
/toggle_whatsapp — Toggle WhatsApp
/toggle_tiktok — Toggle TikTok

*Customer Communication*
/handover <sender_id> <msg> — Reply to a handover
/broadcast <msg> — Message all active customers

*Meta*
/start — Welcome message
/help — This help message`;

  return sendTelegramMessage(chatId, text);
}

/**
 * Default handler for unrecognised commands. Sends a polite hint.
 *
 * @param {string} chatId
 * @returns {Promise<object>}
 */
async function sendUnknownCommand(chatId) {
  return sendTelegramMessage(chatId, '❓ Unknown command. Send /help for the list.');
}

// ---------------------------------------------------------------------------
// 4. Incoming Notifications (Agent → Telegram)
// ---------------------------------------------------------------------------

/**
 * Called by the agent when it detects a handover keyword from a customer.
 * Sends a formatted alert to the owner's Telegram chat.
 *
 * @param {object} payload
 * @param {string} payload.sender_id       Platform-scoped customer id.
 * @param {string} payload.platform        'messenger'|'instagram'|'whatsapp'|'tiktok'.
 * @param {string} [payload.customer_name] Customer display name.
 * @param {string} payload.message         The customer message that triggered the handover.
 * @param {string} [payload.product_interest] Product the customer was discussing.
 * @returns {Promise<object|null>}
 */
async function receiveHandoverNotification({
  sender_id,
  platform,
  customer_name,
  message,
  product_interest
}) {
  try {
    const chatId = String(env.TELEGRAM_CHAT_ID || '');
    if (!chatId) return null;

    const emoji = PLATFORM_EMOJI[platform] || '📱';
    const productLine = product_interest ? `\n🛍️ *Interested in:* ${product_interest}` : '';

    const text =
`🤝 *হ্যান্ডওভার প্রয়োজন*

${emoji} *Platform:* ${platform || 'unknown'}
👤 *Customer:* ${customer_name || 'Unknown'}
🆔 *Sender ID:* \`${sender_id || 'unknown'}\`${productLine}

💬 *Message:*
${message || ''}

↩️ *Reply:* \`/handover ${sender_id || ''} আপনার উত্তর\``;

    return await sendTelegramMessage(chatId, text);
  } catch (err) {
    console.error('[handover-notify] error:', err && err.message ? err.message : err);
    return null;
  }
}

/**
 * Called by the agent when a new order is placed. Sends a formatted
 * summary to the owner's Telegram chat.
 *
 * @param {object} order
 * @param {string|number} order.id
 * @param {string} order.product
 * @param {string} order.size
 * @param {number|string} order.product_price
 * @param {number|string} order.delivery_charge
 * @param {string} order.delivery_area
 * @param {number|string} order.total
 * @param {string} order.name
 * @param {string} order.phone
 * @param {string} order.address
 * @param {string} order.platform
 * @returns {Promise<object|null>}
 */
async function receiveOrderNotification(order) {
  try {
    const chatId = String(env.TELEGRAM_CHAT_ID || '');
    if (!chatId) return null;
    if (!order) return null;

    const emoji = PLATFORM_EMOJI[order.platform] || '📱';
    const timeStr = new Date().toLocaleString('bn-BD');

    const text =
`🛒 *নতুন অর্ডার!*

📦 *Order ID:* #${order.id}
🛍️ *Product:* ${order.product || '-'} (${order.size || '-'})
💰 *Price:* ৳${order.product_price != null ? order.product_price : '-'}
🚚 *Delivery:* ৳${order.delivery_charge != null ? order.delivery_charge : '-'} (${order.delivery_area || '-'})
💵 *Total:* ৳${order.total != null ? order.total : '-'}

👤 *Name:* ${order.name || '-'}
📞 *Phone:* ${order.phone || '-'}
📍 *Address:* ${order.address || '-'}
${emoji} *Platform:* ${order.platform || '-'}
🕐 *Time:* ${timeStr}`;

    return await sendTelegramMessage(chatId, text);
  } catch (err) {
    console.error('[order-notify] error:', err && err.message ? err.message : err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// 5. Helper Functions
// ---------------------------------------------------------------------------

/**
 * Low-level call to the Telegram Bot API. Returns the parsed JSON
 * response, or `{ success: false, error }` on transport failure.
 *
 * @param {string|number} chatId
 * @param {string} text
 * @returns {Promise<object>}
 */
async function sendTelegramMessage(chatId, text) {
  try {
    const token = env.TELEGRAM_BOT_TOKEN;
    if (!token) {
      return { success: false, error: 'Bot token not configured' };
    }

    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'Markdown',
        disable_web_page_preview: true
      })
    });

    return await response.json();
  } catch (err) {
    return {
      success: false,
      error: err && err.message ? err.message : 'network error'
    };
  }
}

// -- Worker fetcher helpers --------------------------------------------------

/**
 * Fetches the agent's current settings (model, platforms, delivery, etc.).
 * @returns {Promise<object>}
 */
async function fetchWorkerSettings() {
  const r = await fetch(`${env.WORKER_URL}/agent/settings`);
  return await r.json();
}

/**
 * Fetches today's aggregated stats from the worker.
 * @returns {Promise<object>}
 */
async function fetchWorkerStats() {
  const r = await fetch(`${env.WORKER_URL}/agent/stats`);
  return await r.json();
}

/**
 * Fetches the most recent N orders.
 * @returns {Promise<Array>}
 */
async function fetchWorkerOrders() {
  const r = await fetch(`${env.WORKER_URL}/agent/orders?limit=5`);
  const data = await r.json();
  return (data && data.orders) || [];
}

/**
 * Fetches the count of currently active conversations.
 * @returns {Promise<number>}
 */
async function fetchWorkerConversationCount() {
  const r = await fetch(`${env.WORKER_URL}/agent/conversations/count`);
  const data = await r.json();
  return (data && data.count) || 0;
}

/**
 * Posts a settings update to the worker.
 *
 * Special value `'toggle'` for a `platform_<name>` key is interpreted by
 * the worker as a boolean flip rather than an assignment.
 *
 * @param {object} updates
 * @returns {Promise<object>}
 */
async function updateWorkerSettings(updates) {
  const r = await fetch(`${env.WORKER_URL}/agent/settings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates)
  });
  return await r.json();
}

/**
 * Asks the worker to send a one-off message to a customer on whatever
 * platform they originally messaged on.
 *
 * @param {string} senderId
 * @param {string} message
 * @returns {Promise<object>}
 */
async function sendHandoverReply(senderId, message) {
  const r = await fetch(`${env.WORKER_URL}/agent/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sender_id: senderId, message })
  });
  return await r.json();
}

/**
 * Asks the worker to broadcast a message to every active conversation.
 *
 * @param {string} message
 * @returns {Promise<object>}
 */
async function broadcastToAll(message) {
  const r = await fetch(`${env.WORKER_URL}/agent/broadcast`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message })
  });
  return await r.json();
}

// ---------------------------------------------------------------------------
// 6. Worker Route Registration (reference)
// ---------------------------------------------------------------------------

/*
 * In worker-supabase.js, add this route to the action map inside
 * handleRequest():
 *
 *   case "/telegram/webhook": return await handleTelegramWebhook(request);
 *
 * The worker reads the raw request body, JSON.parses it, and forwards the
 * resulting update object directly to handleTelegramWebhook.
 *
 * Setting up the Telegram webhook (one-time, from any HTTP client):
 *
 *   POST https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook
 *   Content-Type: application/json
 *   { "url": "<WORKER_URL>/telegram/webhook" }
 *
 * Example env vars (Cloudflare Worker dashboard → Settings → Variables):
 *   TELEGRAM_BOT_TOKEN = 7123456789:AAF...
 *   TELEGRAM_CHAT_ID   = 8370659578
 *   WORKER_URL         = https://yarz-agent.example.workers.dev
 */

// ---------------------------------------------------------------------------
// 7. ES Module Exports
// ---------------------------------------------------------------------------

export {
  setEnv,
  handleTelegramWebhook,
  sendWelcome,
  sendStatus,
  switchModel,
  togglePlatform,
  showOrders,
  showConversations,
  handleHandoverReply,
  broadcastMessage,
  sendHelp,
  sendUnknownCommand,
  receiveHandoverNotification,
  receiveOrderNotification,
  sendTelegramMessage,
  fetchWorkerSettings,
  fetchWorkerStats,
  fetchWorkerOrders,
  fetchWorkerConversationCount,
  updateWorkerSettings,
  sendHandoverReply,
  broadcastToAll,
  VALID_MODELS,
  VALID_PLATFORMS,
  PLATFORM_EMOJI
};
