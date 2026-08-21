const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

const send_notification = async (profile_id, notification, req) => {
  console.log("========== SEND NOTIFICATION START ==========");

  const { db } = req;

  console.log("[PUSH] Profile:", profile_id);
  console.log("[PUSH] Notification:", notification);

  const Devices = await db.folder("Devices");

  const devices = await Devices.find({
    profile: profile_id,
    active: true,
  }).toArray();

  console.log("[PUSH] Active devices:", devices.length);

  if (!devices.length) {
    console.log("[PUSH] No active devices found");

    console.log("========== SEND NOTIFICATION END ==========");

    return {
      ok: true,
      sent: 0,
      tickets: [],
    };
  }

  const messages = devices.map((device) => ({
    to: device.token,
    title: notification.title,
    body: notification.text || notification.body,
    sound: "default",
    data: notification.data || {},
  }));

  console.log("[PUSH] Messages:", JSON.stringify(messages, null, 2));

  let response;

  try {
    response = await fetch(EXPO_PUSH_URL, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Accept-encoding": "gzip, deflate",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(messages),
    });
  } catch (error) {
    console.error("[PUSH] Expo request failed:", error);

    console.log("========== SEND NOTIFICATION END ==========");

    return {
      ok: false,
      sent: 0,
      tickets: [],
      error: error.message,
    };
  }

  const result = await response.json();

  console.log("[PUSH] Expo HTTP status:", response.status);

  console.log("[PUSH] Expo response:", JSON.stringify(result, null, 2));

  if (!response.ok) {
    console.log("========== SEND NOTIFICATION END ==========");

    return {
      ok: false,
      sent: 0,
      tickets: [],
      error: result,
    };
  }

  const tickets = result?.data || [];

  console.log("[PUSH] Tickets received:", tickets.length);

  console.log("========== SEND NOTIFICATION END ==========");

  return {
    ok: true,
    sent: tickets.length,
    tickets,
  };
};

export { send_notification };
