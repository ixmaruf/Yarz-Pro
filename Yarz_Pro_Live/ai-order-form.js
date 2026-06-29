/**
 * =====================================================================
 * YARZ AI Order Form Module
 * Date: 2026-06-30
 *
 * Multi-platform order form template generators and delivery charge
 * logic for the YARZ AI Agent (Messenger, Instagram, WhatsApp, TikTok).
 *
 * Designed to run in a Cloudflare Worker (or any ES-module runtime)
 * that posts the generated payloads to Meta / WhatsApp Cloud APIs.
 *
 * All functions are pure: no side effects, no network calls, no I/O.
 * Placeholder tokens like {{PSID}}, {{PHONE}}, {{PRODUCT_IMAGE}} are
 * intentionally left in payloads for the worker to fill in before send.
 * =====================================================================
 */

// ---------------------------------------------------------------------------
// 1. Delivery Charge Calculator
// ---------------------------------------------------------------------------

/**
 * Default delivery-charge settings for Narayanganj district.
 * Override per call by passing a `settings` object.
 */
const DEFAULT_DELIVERY_SETTINGS = Object.freeze({
  narayanganj_in: 80,
  narayanganj_out: 125
});

/**
 * Determines delivery charge based on customer address.
 *
 * - Narayanganj Inside  = `narayanganj_in`  taka (default 80)
 * - Narayanganj Outside = `narayanganj_out` taka (default 125)
 *
 * Detection is keyword-based and supports both Bangla and English
 * spellings of the district and its major areas (Fatullah, Siddhirganj,
 * Kadamrasul, etc.).
 *
 * @param {string} address           Free-form address text from customer.
 * @param {object} [settings]        Optional override of the two charges.
 * @returns {{charge:number, area:string, label:string}}
 */
function calcDeliveryCharge(address, settings = DEFAULT_DELIVERY_SETTINGS) {
  // Defensive: null / undefined / non-string all map to Outside.
  if (!address || typeof address !== 'string') {
    return {
      charge: settings.narayanganj_out,
      area: 'Outside Narayanganj',
      label: `Narayanganj Outside ${settings.narayanganj_out} taka`
    };
  }

  const lower = address.toLowerCase();

  // Keywords covering the district and its principal neighbourhoods.
  const narayanganjKeywords = [
    'narayanganj', 'নারায়ণগঞ্জ',
    'sidderganj', 'siddhirganj', 'সিদ্ধিরগঞ্জ',
    'fatullah', 'ফতুল্লা',
    'kadamrasul', 'কদমরসুল'
  ];

  const isInside = narayanganjKeywords.some(kw => lower.includes(kw));

  if (isInside) {
    return {
      charge: settings.narayanganj_in,
      area: 'Inside Narayanganj',
      label: `Narayanganj Inside ${settings.narayanganj_in} taka`
    };
  }

  return {
    charge: settings.narayanganj_out,
    area: 'Outside Narayanganj',
    label: `Narayanganj Outside ${settings.narayanganj_out} taka`
  };
}

// ---------------------------------------------------------------------------
// 2. Messenger Generic Template (initial product card)
// ---------------------------------------------------------------------------

/**
 * Generates a Messenger "generic template" payload showing the order form.
 * The worker must replace {{PSID}} and {{PRODUCT_IMAGE}} before POSTing
 * to the Meta Send API.
 *
 * @param {string} productName        Display name of the product.
 * @param {number|string} productPrice Price in taka (integer recommended).
 * @param {string[]} [productSizes]   Unused by Messenger template itself
 *                                    but kept on the signature for parity
 *                                    with other helpers.
 * @returns {object} Meta Send API generic-template payload.
 */
function buildMessengerOrderForm(productName, productPrice, productSizes = ['S', 'M', 'L', 'XL', 'XXL']) {
  // productSizes is intentionally part of the signature but unused here;
  // the size question is asked later in buildOrderStepMessage('size', ...).
  void productSizes;

  return {
    recipient: { id: '{{PSID}}' }, // worker fills in with the page-scoped ID
    message: {
      attachment: {
        type: 'template',
        payload: {
          template_type: 'generic',
          elements: [{
            title: `🛍️ ${productName}`,
            subtitle: `মূল্য: ৳${productPrice}\n\nঅর্ডার করতে নিচের তথ্যগুলো পূরণ করুন:`,
            image_url: '{{PRODUCT_IMAGE}}', // worker fills in
            buttons: [
              { type: 'postback', title: '📝 অর্ডার ফর্ম পূরণ করুন', payload: 'START_ORDER' },
              { type: 'phone_number', title: '📞 কল করুন', payload: '+8801XXXXXXXXX' }
            ]
          }]
        }
      }
    }
  };
}

// ---------------------------------------------------------------------------
// 3. Quick-Reply Form for Messenger (step-by-step)
// ---------------------------------------------------------------------------

/**
 * Generates quick-reply buttons / text prompts for each step of the
 * Messenger order conversation.
 *
 *   step = 'name'    -> free-text prompt for the customer's name
 *   step = 'phone'   -> free-text prompt + "share my phone number" button
 *   step = 'address' -> free-text prompt with delivery-charge info
 *   step = 'size'    -> quick-reply buttons for S/M/L/XL/XXL
 *
 * @param {'name'|'phone'|'address'|'size'} step
 * @param {string} productName Used in the greeting line of the name step.
 * @returns {object|null}     Step payload, or null if `step` is unknown.
 */
function buildOrderStepMessage(step, productName) {
  const steps = {
    name: {
      text: `✅ ${productName} অর্ডার করতে আপনার নাম লিখুন:`,
      quick_replies: []
    },
    phone: {
      text: `📞 এবার আপনার ফোন নম্বর দিন (যেমন: 01712345678):`,
      quick_replies: [
        { content_type: 'user_phone_number', title: '📱 আমার নম্বর', payload: 'PHONE_SHARE' }
      ]
    },
    address: {
      text: `📍 সম্পূর্ণ ঠিকানা লিখুন (এরিয়া + জেলা সহ):\n\n` +
            `💡 যদি নারায়ণগঞ্জের ভিতরে হন, ডেলিভারি চার্জ ৳80\n` +
            `💡 নারায়ণগঞ্জের বাইরে হলে ৳125`,
      quick_replies: []
    },
    size: {
      text: `📏 কোন সাইজ নিবেন?`,
      quick_replies: [
        { content_type: 'text', title: 'S',    payload: 'SIZE_S' },
        { content_type: 'text', title: 'M',    payload: 'SIZE_M' },
        { content_type: 'text', title: 'L',    payload: 'SIZE_L' },
        { content_type: 'text', title: 'XL',   payload: 'SIZE_XL' },
        { content_type: 'text', title: 'XXL',  payload: 'SIZE_XXL' }
      ]
    }
  };

  return steps[step] || null;
}

// ---------------------------------------------------------------------------
// 4. Order Summary Confirmation (formatted text)
// ---------------------------------------------------------------------------

/**
 * Builds the human-readable order summary shown right before the customer
 * confirms ("হ্যাঁ" / "না"). Returns a plain string suitable for any
 * text-based channel (Messenger, Instagram, TikTok, WhatsApp text body).
 *
 * @param {object}  order
 * @param {string}  order.name            Customer's full name.
 * @param {string}  order.phone           Customer's phone (BD format).
 * @param {string}  order.address         Full delivery address.
 * @param {string}  order.size            Chosen size (S/M/L/XL/XXL).
 * @param {string}  order.productName     Product display name.
 * @param {number|string} order.productPrice  Unit price in taka.
 * @param {number|string} order.deliveryCharge Delivery fee in taka.
 * @param {string}  order.deliveryArea    "Inside Narayanganj" / "Outside Narayanganj".
 * @returns {string} Bengali order-summary text with total.
 */
function buildOrderSummary({
  name,
  phone,
  address,
  size,
  productName,
  productPrice,
  deliveryCharge,
  deliveryArea
}) {
  const priceNum = Number(productPrice) || 0;
  const chargeNum = Number(deliveryCharge) || 0;
  const total = priceNum + chargeNum;

  return `📋 *অর্ডার কনফার্মেশন*

আসসালামু আলাইকুম! আপনার অর্ডারের বিবরণ:

👤 *নাম:* ${name}
📞 *ফোন:* ${phone}
📍 *ঠিকানা:* ${address}
📦 *পণ্য:* ${productName}
📏 *সাইজ:* ${size}
💰 *মূল্য:* ৳${priceNum}
🚚 *ডেলিভারি চার্জ (${deliveryArea}):* ৳${chargeNum}
💵 *সর্বমোট:* ৳${total}

✅ অর্ডার কনফার্ম করতে "হ্যাঁ" লিখুন
❌ বাতিল করতে "না" লিখুন`;
}

// ---------------------------------------------------------------------------
// 5. Instagram DM Version (text-based; IG has limited templates)
// ---------------------------------------------------------------------------

/**
 * Instagram does not support Messenger-style generic templates, so we
 * fall back to a clean plain-text prompt the customer can reply to.
 *
 * @param {string} productName
 * @param {number|string} productPrice
 * @returns {string} Bengali plain-text order prompt.
 */
function buildInstagramOrderForm(productName, productPrice) {
  return `🛍️ *${productName}*\n` +
         `💰 মূল্য: ৳${productPrice}\n\n` +
         `অর্ডার করতে এই তথ্যগুলো পাঠান:\n\n` +
         `1️⃣ আপনার নাম\n` +
         `2️⃣ ফোন নম্বর\n` +
         `3️⃣ সম্পূর্ণ ঠিকানা\n` +
         `4️⃣ সাইজ (S/M/L/XL/XXL)\n\n` +
         `💡 নারায়ণগঞ্জের ভিতরে ডেলিভারি ৳80\n` +
         `💡 বাইরে ৳125`;
}

// ---------------------------------------------------------------------------
// 6. WhatsApp Business Version (interactive button template)
// ---------------------------------------------------------------------------

/**
 * Builds a WhatsApp Cloud API "interactive button" payload. The worker
 * must replace {{PHONE}} with the customer's E.164 number before POST.
 *
 * @param {string} productName
 * @param {number|string} productPrice
 * @param {string} productId          Stable ID used in the button callback.
 * @returns {object} WhatsApp interactive-button payload.
 */
function buildWhatsAppOrderForm(productName, productPrice, productId) {
  return {
    messaging_product: 'whatsapp',
    to: '{{PHONE}}', // worker fills in
    type: 'interactive',
    interactive: {
      type: 'button',
      body: {
        text: `🛍️ *${productName}*\n` +
              `💰 মূল্য: ৳${productPrice}\n\n` +
              `অর্ডার করতে বোতাম চাপুন:`
      },
      action: {
        buttons: [
          { type: 'reply', reply: { id: `ORDER_${productId}`, title: '✅ অর্ডার করুন' } },
          { type: 'reply', reply: { id: 'ASK_QUESTION',      title: '❓ প্রশ্ন আছে' } }
        ]
      }
    }
  };
}

// ---------------------------------------------------------------------------
// 7. TikTok DM Version (text-based; TikTok has no templates)
// ---------------------------------------------------------------------------

/**
 * TikTok DMs have no structured templates, so we use a compact
 * bulleted-text prompt.
 *
 * @param {string} productName
 * @param {number|string} productPrice
 * @returns {string} Plain-text TikTok order prompt.
 */
function buildTikTokOrderForm(productName, productPrice) {
  return `🛍️ ${productName}\n` +
         `💰 মূল্য: ৳${productPrice}\n\n` +
         `অর্ডার করতে পাঠান:\n` +
         `- নাম\n` +
         `- ফোন\n` +
         `- ঠিকানা\n` +
         `- সাইজ\n\n` +
         `🚚 নারায়ণগঞ্জ ভিতরে ৳80, বাইরে ৳125`;
}

// ---------------------------------------------------------------------------
// 8. Order Validation
// ---------------------------------------------------------------------------

/**
 * Validates customer-supplied order fields before submission.
 * Phone is checked against the Bangladesh mobile-number pattern
 * (11 digits, starts with 01, second digit 3-9). Address must be at
 * least 10 characters to discourage useless entries.
 *
 * @param {object} data
 * @param {string} data.name
 * @param {string} data.phone
 * @param {string} data.address
 * @param {string} data.size
 * @returns {{valid:boolean, errors:string[]}}
 */
function validateOrderForm(data) {
  const errors = [];

  // Name
  if (!data || !data.name || String(data.name).trim().length < 2) {
    errors.push('নাম অবশ্যই দিতে হবে (কমপক্ষে ২ অক্ষর)');
  }

  // Phone — BD mobile: 11 digits, leading 01, second digit 3-9.
  // Tolerate spaces, dashes, and the +88 country prefix.
  const rawPhone = data && data.phone ? String(data.phone) : '';
  const phoneDigits = rawPhone.replace(/[\s\-]/g, '').replace(/^\+?88/, '');
  if (!phoneDigits || !/^01[3-9]\d{8}$/.test(phoneDigits)) {
    errors.push('সঠিক ফোন নম্বর দিন (11 ডিজিট, 01 দিয়ে শুরু)');
  }

  // Address — guard against trivial entries like "dhaka".
  if (!data || !data.address || String(data.address).trim().length < 10) {
    errors.push('সম্পূর্ণ ঠিকানা দিন (কমপক্ষে 10 অক্ষর)');
  }

  // Size — accept upper or lower case.
  const size = data && data.size ? String(data.size).trim() : '';
  const allowedSizes = ['S', 'M', 'L', 'XL', 'XXL'];
  if (!size || !allowedSizes.includes(size.toUpperCase())) {
    errors.push('সঠিক সাইজ দিন (S/M/L/XL/XXL)');
  }

  return { valid: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// 9. ES Module Exports
// ---------------------------------------------------------------------------

export {
  calcDeliveryCharge,
  buildMessengerOrderForm,
  buildOrderStepMessage,
  buildOrderSummary,
  buildInstagramOrderForm,
  buildWhatsAppOrderForm,
  buildTikTokOrderForm,
  validateOrderForm
};
