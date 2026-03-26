// WhatsApp Cloud API Proxy — Netlify Function
// Environment variables needed (set in Netlify dashboard):
//   WHATSAPP_TOKEN   = your permanent access token
//   WHATSAPP_PHONE_ID = your WhatsApp business phone number ID

export async function handler(event) {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json"
  };

  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers, body: "" };
  if (event.httpMethod !== "POST") return { statusCode: 405, headers, body: JSON.stringify({ error: "Method not allowed" }) };

  try {
    const { to, message, type } = JSON.parse(event.body);
    
    if (!to || !message) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "Missing 'to' or 'message'" }) };
    }

    const TOKEN = process.env.WHATSAPP_TOKEN;
    const PHONE_ID = process.env.WHATSAPP_PHONE_ID;

    if (!TOKEN || !PHONE_ID) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: "WhatsApp not configured. Set WHATSAPP_TOKEN and WHATSAPP_PHONE_ID in Netlify environment variables." }) };
    }

    // Format phone number — ensure it starts with country code
    let phone = to.replace(/[^0-9]/g, "");
    if (phone.startsWith("0")) phone = "962" + phone.slice(1); // Jordan
    if (!phone.startsWith("962")) phone = "962" + phone;

    const response = await fetch(
      `https://graph.facebook.com/v21.0/${PHONE_ID}/messages`,
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${TOKEN}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: phone,
          type: "text",
          text: { body: message }
        })
      }
    );

    const data = await response.json();

    if (!response.ok) {
      return { statusCode: response.status, headers, body: JSON.stringify({ error: data.error?.message || "WhatsApp API error", details: data }) };
    }

    return { statusCode: 200, headers, body: JSON.stringify({ success: true, messageId: data.messages?.[0]?.id, data }) };

  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
}
