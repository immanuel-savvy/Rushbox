const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const EXPO_TOKEN_PATTERN = /^ExponentPushToken\[[^\]]+\]$/;

// Validate an Expo push token.
const is_valid_push_token = (token) => {
  return typeof token === "string" && EXPO_TOKEN_PATTERN.test(token);
};

// Register or update a device's Expo push token.
const register_push_token = async (req) => {
  const { db, headers, body = {} } = req;
  const profile = headers?.profile;

  const { token, platform, device_id } = body;

  if (!profile?._id) {
    return {
      ok: false,
      status: 401,
      message: "Authenticated profile is required",
    };
  }

  if (!is_valid_push_token(token)) {
    return {
      ok: false,
      status: 400,
      message: "A valid Expo push token is required",
    };
  }

  const Devices = await db.folder("Devices");
  const now = Date.now();

  const existing = await Devices.findOne({ token });

  if (existing) {
    await Devices.updateOne(
      { _id: existing._id },
      {
        $set: {
          profile: profile._id,
          platform: platform || existing.platform || null,
          device_id: device_id || existing.device_id || null,
          active: true,
          updated: now,
        },
      },
    );

    return {
      ok: true,
      status: 200,
      message: "Push token updated",
      data: {
        _id: existing._id,
        token,
      },
    };
  }

  const _id = crypto.randomUUID();

  await Devices.insertOne({
    _id,
    profile: profile._id,
    token,
    platform: platform || null,
    device_id: device_id || null,
    active: true,
    created: now,
    updated: now,
  });

  return {
    ok: true,
    status: 201,
    message: "Push token registered",
    data: {
      _id,
      token,
    },
  };
};

// Send notifications to devices in batches of up to 100.
//
// Every outcome corresponds to exactly one valid device, in the
// same order as the valid devices supplied to this function.
//
// An Expo ticket with status "ok" means Expo accepted the message.
// It does not prove that the recipient's device displayed it.
const send_to_devices = async (devices, notification) => {
  const validDevices = devices.filter((device) =>
    is_valid_push_token(device.token),
  );

  if (!validDevices.length) {
    return {
      ok: false,
      sent: 0,
      failed: 0,
      devices: 0,
      tickets: [],
      outcomes: [],
    };
  }

  const messages = validDevices.map((device) => ({
    to: device.token,
    title: notification.title,
    body: notification.description,
    sound: "default",
    data: notification.data || {},
  }));

  const outcomes = [];

  let sent = 0;
  let failed = 0;

  // Expo accepts batches of up to 100 messages.
  for (let i = 0; i < messages.length; i += 100) {
    const batch = messages.slice(i, i + 100);

    try {
      const response = await fetch(EXPO_PUSH_URL, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Accept-encoding": "gzip, deflate",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(batch),
      });

      let result;

      try {
        result = await response.json();
      } catch {
        result = null;
      }

      // A failed HTTP request applies to every message in this batch.
      // Still produce one outcome per recipient.
      if (!response.ok) {
        for (let j = 0; j < batch.length; j++) {
          const ticket = {
            status: "error",
            message: "Expo returned an HTTP error",
            details: result,
            http_status: response.status,
          };

          outcomes.push({
            status: "failed",
            ticket,
            error: `Expo returned HTTP ${response.status}`,
          });

          failed++;
        }

        continue;
      }

      let batchTickets = Array.isArray(result?.data)
        ? result.data
        : result?.data
          ? [result.data]
          : [];

      // Match each ticket to its corresponding message by index.
      for (let j = 0; j < batch.length; j++) {
        const ticket = batchTickets[j] || null;

        if (ticket?.status === "ok") {
          outcomes.push({
            status: "sent",
            ticket,
            error: null,
          });

          sent++;
        } else {
          const error =
            ticket?.message ||
            ticket?.details?.error ||
            "Expo did not return a successful ticket";

          outcomes.push({
            status: "failed",
            ticket: ticket || {
              status: "error",
              message: error,
            },
            error,
          });

          failed++;
        }
      }
    } catch (error) {
      // Network or fetch errors also produce one outcome per recipient.
      for (let j = 0; j < batch.length; j++) {
        const message = error?.message || "Unknown network error";

        outcomes.push({
          status: "failed",
          ticket: {
            status: "error",
            message,
          },
          error: message,
        });

        failed++;
      }
    }
  }

  return {
    ok: failed === 0,
    sent,
    failed,
    devices: validDevices.length,
    tickets: outcomes.map((outcome) => outcome.ticket),
    outcomes,
  };
};

// Send a notification directly to all active devices belonging to one user.
// This does not create a reusable Notifications record.
const send_user_notification = async (req) => {
  const { db, body = {} } = req;

  const { title, profile_id, text, body: messageBody, data = {} } = body;

  const description = text || messageBody;

  if (!profile_id) {
    return {
      ok: false,
      status: 400,
      message: "profile_id is required",
    };
  }

  if (
    typeof title !== "string" ||
    !title.trim() ||
    typeof description !== "string" ||
    !description.trim()
  ) {
    return {
      ok: false,
      status: 400,
      message: "title and text are required",
    };
  }

  const Devices = await db.folder("Devices");

  const devices = await Devices.find({
    profile: profile_id,
    active: true,
  }).toArray();

  if (!devices.length) {
    return {
      ok: true,
      status: 200,
      message: "No active devices registered for this user",
      data: {
        sent: 0,
        failed: 0,
        devices: 0,
      },
    };
  }

  const result = await send_to_devices(devices, {
    title: title.trim(),
    description: description.trim(),
    data,
  });

  return {
    ...result,
    status: result.ok ? 200 : 502,
    message: "User notification processed",
  };
};

// Create and store a reusable notification message.
//
// This only saves the message details.
// It does not send a notification or create audience records.
const create_notification = async (req) => {
  const { db, body = {}, headers } = req;

  const { title, description, text, body: messageBody, data = {} } = body;

  const messageText = description || text || messageBody;

  if (
    typeof title !== "string" ||
    !title.trim() ||
    typeof messageText !== "string" ||
    !messageText.trim()
  ) {
    return {
      ok: false,
      status: 400,
      message: "title and description are required",
    };
  }

  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    return {
      ok: false,
      status: 400,
      message: "data must be an object",
    };
  }

  const Notifications = await db.folder("Notifications");

  const now = Date.now();
  const message_id = crypto.randomUUID();

  await Notifications.insertOne({
    _id: message_id,
    title: title.trim(),
    description: messageText.trim(),
    data,
    created_by: headers?.profile?._id || null,
    created: now,
    updated: now,
  });

  return {
    ok: true,
    status: 201,
    message: "Notification message created",
    data: {
      message_id,
    },
  };
};

// Send a stored notification message to explicitly supplied Expo tokens.
//
// Each invocation creates a new run_id and new audience records.
// Sending the same message again creates another broadcast period.
const send_notification = async (req) => {
  const { db, body = {} } = req;
  const { message_id, profile_id } = body;

  if (!message_id || !profile_id) {
    return {
      ok: false,
      status: 400,
      message: "message_id and profile_id are required",
    };
  }

  const Notifications = await db.folder("Notifications");
  const Devices = await db.folder("Devices");
  const Audiences = await db.folder("Notification_Audiences");

  const message = await Notifications.findOne({
    _id: message_id,
  });

  if (!message) {
    return {
      ok: false,
      status: 404,
      message: "Notification message not found",
    };
  }

  const devices = await Devices.find({
    profile: profile_id,
    active: true,
  }).toArray();

  const uniqueDevices = [
    ...new Map(
      devices
        .filter((device) => is_valid_push_token(device.token))
        .map((device) => [device.token, device]),
    ).values(),
  ];

  if (!uniqueDevices.length) {
    return {
      ok: false,
      status: 404,
      message:
        "No active devices with valid Expo push tokens found for this profile",
    };
  }

  const run_id = crypto.randomUUID();
  const now = Date.now();

  const audience = uniqueDevices.map((device) => ({
    _id: crypto.randomUUID(),
    message_id,
    run_id,
    token: device.token,
    profile: device.profile || profile_id,
    device_id: device.device_id || null,
    platform: device.platform || null,
    status: "pending",
    ticket: null,
    error: null,
    created: now,
    updated: now,
  }));

  for (const recipient of audience) {
    await Audiences.insertOne(recipient);
  }

  const result = await send_to_devices(audience, {
    title: message.title,
    description: message.description,
    data: message.data || {},
  });

  for (let i = 0; i < audience.length; i++) {
    const outcome = result.outcomes[i] || {
      status: "failed",
      ticket: null,
      error: "No outcome was returned for this recipient",
    };

    await Audiences.updateOne(
      { _id: audience[i]._id },
      {
        $set: {
          status: outcome.status,
          ticket: outcome.ticket,
          error: outcome.error,
          updated: Date.now(),
        },
      },
    );
  }

  return {
    ok: result.ok,
    status: result.ok ? 200 : 502,
    message: "Notification send run completed",
    data: {
      message_id,
      profile_id,
      run_id,
      recipients: audience.length,
      sent: result.sent,
      failed: result.failed,
    },
  };
};

// Broadcast a stored notification message to every unique active device.
//
// Every invocation creates a separate run and audience history.
const broadcast_notification = async (req) => {
  const { db, body = {} } = req;

  const { message_id } = body;

  const Notifications = await db.folder("Notifications");
  const Devices = await db.folder("Devices");
  const Audiences = await db.folder("Notification_Audiences");

  const message = await Notifications.findOne({
    _id: message_id,
  });

  if (!message) {
    return {
      ok: false,
      status: 404,
      message: "Notification message not found",
    };
  }

  const devices = await Devices.find({
    active: true,
  }).toArray();

  // Deduplicate devices by token so the same token is not sent twice
  // in one broadcast run.
  const uniqueDevices = [
    ...new Map(
      devices
        .filter((device) => is_valid_push_token(device.token))
        .map((device) => [device.token, device]),
    ).values(),
  ];

  if (!uniqueDevices.length) {
    return {
      ok: false,
      status: 404,
      message: "No active devices with valid Expo push tokens found",
    };
  }

  const run_id = crypto.randomUUID();
  const now = Date.now();

  const audience = uniqueDevices.map((device) => ({
    _id: crypto.randomUUID(),
    message_id,
    run_id,
    token: device.token,
    profile: device.profile || null,
    device_id: device.device_id || null,
    platform: device.platform || null,
    status: "pending",
    ticket: null,
    error: null,
    created: now,
    updated: now,
  }));

  // Persist audience records before sending so attempted recipients
  // are recorded even if a later send operation fails.
  for (const recipient of audience) {
    await Audiences.insertOne(recipient);
  }

  const result = await send_to_devices(audience, {
    title: message.title,
    description: message.description,
    data: message.data || {},
  });

  for (let i = 0; i < audience.length; i++) {
    const outcome = result.outcomes[i] || {
      status: "failed",
      ticket: null,
      error: "No outcome was returned for this recipient",
    };

    await Audiences.updateOne(
      { _id: audience[i]._id },
      {
        $set: {
          status: outcome.status,
          ticket: outcome.ticket,
          error: outcome.error,
          updated: Date.now(),
        },
      },
    );
  }

  return {
    ok: result.ok,
    status: result.ok ? 200 : 502,
    message: "Broadcast run completed",
    data: {
      message_id,
      run_id,
      recipients: audience.length,
      sent: result.sent,
      failed: result.failed,
    },
  };
};

// Delete a stored notification and all its audience history.
//
// This permanently removes the message and every run associated with it.
const delete_notification = async (req) => {
  const { db, body = {} } = req;

  const { message_id } = body;

  const Notifications = await db.folder("Notifications");
  const Audiences = await db.folder("Notification_Audiences");

  const message = await Notifications.findOne({
    _id: message_id,
  });

  if (!message) {
    return {
      ok: false,
      status: 404,
      message: "Notification message not found",
    };
  }

  // Delete the dependent audience records before deleting the message.
  await Audiences.deleteMany({
    message_id,
  });

  await Notifications.deleteOne({
    _id: message_id,
  });

  return {
    ok: true,
    status: 200,
    message: "Notification and its audience history deleted",
    data: {
      message_id,
    },
  };
};

export {
  register_push_token,
  send_user_notification,
  create_notification,
  send_notification,
  broadcast_notification,
  delete_notification,
};
