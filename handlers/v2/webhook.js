import crypto from "crypto";
import { create_delivery } from "./delivery.js";
import { credit_wallet } from "../../services/wallet.js";
import { webhook_courier } from "../../libs/couriers/index.js";
import { send_notification } from "./push_noti.js";
import { STATUSES_MESSAGE } from "../../libs/couriers/statuses_map.js";
import { hash } from "../../libs/utils/hash.js";

const courier_webhook = async (req, opts = {}) => {
  let { webhook_order, courier } = opts;
  console.log("========== COURIER WEBHOOK START ==========");

  let { params, db, body, headers, query } = req;
  courier = courier || params.courier;

  console.log("[WEBHOOK] Params:", params);
  console.log("[WEBHOOK] Courier:", courier);
  console.log("[WEBHOOK] Headers:", headers);
  console.log("[WEBHOOK] Body:", body);
  console.log("[WEBHOOK] DB available:", !!db);

  let handler = webhook_courier[courier];

  console.log("[WEBHOOK] Handler found:", !!handler);

  if (!handler) {
    console.log("[WEBHOOK] No handler for courier:", courier);
    console.log("========== COURIER WEBHOOK END ==========");

    return {
      ok: true,
      status: 200,
    };
  }

  console.log("[WEBHOOK] Calling courier handler...");

  let result;

  try {
    result = await handler(req, { staging: query.staging, webhook_order });
    console.log("[WEBHOOK] Handler result:", result);
  } catch (error) {
    console.error("[WEBHOOK] Handler error:", error);
    console.log("========== COURIER WEBHOOK END ==========");

    return {
      ok: false,
      status: 500,
    };
  }

  if (!result) {
    console.log("[WEBHOOK] Handler returned no result");
    console.log("========== COURIER WEBHOOK END ==========");

    return {
      status: 403,
    };
  }

  console.log("[WEBHOOK] Handler succeeded");

  if (result?.order) {
    console.log("[WEBHOOK] Order found:", result.order);

    let { user_id, ongoing_status, _id } = result.order;

    console.log("[WEBHOOK] Order ID:", _id);
    console.log("[WEBHOOK] User ID:", user_id);
    console.log("[WEBHOOK] Ongoing status:", ongoing_status);
    console.log("[WEBHOOK] Status timestamp:", result.order[ongoing_status]);

    const notification = {
      title: "Order status",
      text: STATUSES_MESSAGE[ongoing_status],
      _id: crypto.randomUUID(),
      type: "ongoing_order",
      user_id,
      data: {
        order_id: _id,
      },
    };

    console.log("[WEBHOOK] Sending notification:", notification);

    try {
      await send_notification(user_id, notification, req);

      console.log("[WEBHOOK] Notification sent successfully");
    } catch (error) {
      console.error("[WEBHOOK] Notification error:", error);
    }

    let payload = {
      order_id: _id,
      user_id,
      ongoing_status,
      time: result.order[ongoing_status],
    };

    console.log("[WEBHOOK] Live event payload:", payload);

    try {
      const livechat_response = await fetch(
        `https://livechat.rushbox.biz/send_event`,
        {
          method: "POST",
          headers: {
            "Content-type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({
            user: user_id,
            name: "ongoing_order_status",
            payload,
          }),
        },
      );

      console.log("[WEBHOOK] Livechat status:", livechat_response.status);

      const livechat_text = await livechat_response.text();

      console.log("[WEBHOOK] Livechat response:", livechat_text);
    } catch (error) {
      console.error("[WEBHOOK] Livechat error:", error);
    }
  } else {
    console.log("[WEBHOOK] No order in handler result");
  }

  console.log("[WEBHOOK] Returning success");
  console.log("========== COURIER WEBHOOK END ==========");

  return {
    ok: true,
    status: 200,
    data: result,
  };
};

const paystack_webhook_events_listener = async (req) => {
  let { body, db } = req;

  let hash_ = crypto
    .createHmac("sha512", process.env.PAYSTACK_SECRET)
    .update(JSON.stringify(body))
    .digest("hex");

  let test_hash_ = crypto
    .createHmac("sha512", process.env.PAYSTACK_TEST_SECRET)
    .update(JSON.stringify(body))
    .digest("hex");

  const EventLogs = await db.folder("Event_logs");
  await EventLogs.insertOne(body);
  console.log("Paystack webhook body inserted", {
    event: body.event,
    reference: body.data?.reference,
  });

  console.log("Paystack signature check", {
    received: req.headers["x-paystack-signature"],
    expected: [test_hash_, hash_],
  });

  if ([test_hash_, hash_].includes(req.headers["x-paystack-signature"])) {
    console.log("Paystack signature valid", body.event);
    if (body.event === "charge.success") {
      console.log("Processing charge.success", body.data.reference);
      let customer = body.data.customer;
      let customer_hash = hash(customer.customer_code);
      console.log("Customer code hash", customer_hash);
      let virtual_account = await (
        await db.folder("Virtual_accounts")
      ).findOne({ _id: customer_hash });
      console.log("Virtual account lookup", {
        found: !!virtual_account,
        virtual_account_id: virtual_account?._id,
      });

      let value = body.data.amount / 100;
      console.log("Charge amount converted", value);
      if (virtual_account) {
        console.log("Crediting wallet", { user: virtual_account.user, value });
        await credit_wallet(virtual_account.user, value, {
          authorization: body.data.authorization,
          db,
        });
      } else {
        console.log(
          "No virtual account found, saving payment ref",
          body.data.reference,
        );
        await (
          await db.folder("Payment_refs")
        ).updateOne(
          { _id: body.data.reference },
          { $set: body.data },
          { upsert: true },
        );

        let Pending_deliveries = await db.folder("Pending_deliveries");
        let exists = await Pending_deliveries.findOne({
          _id: body.data.reference,
        });
        console.log("Pending delivery check", {
          reference: body.data.reference,
          exists: !!exists,
        });

        if (exists) {
          console.log(
            "Creating delivery from pending delivery",
            exists.delivery_details,
          );
          await create_delivery(
            { ...exists.delivery_details, profile: exists.profile },
            {
              db,
              from_webhook: true,
            },
          );
        }
      }
    }
    return {
      status: 200,
      ok: true,
    };
  } else
    return {
      status: 403,
      ok: false,
    };
};

const socket_webhook = async (req) => {
  let { params, db, body, headers, services, memory, gp } = req;
  let { debug } = gp.utils;

  const log = (stage, data = {}) => {
    const entry = {
      scope: "socket_webhook",
      stage,
      timestamp: new Date().toISOString(),
      ...data,
    };

    if (typeof debug === "function") {
      debug(entry);
    } else {
      console.log("[socket_webhook]", entry);
    }
  };

  const fail = (stage, result) => {
    log(stage, {
      ok: false,
      status: result.status ?? result.status_code ?? null,
      message: result.message,
    });

    return result;
  };

  try {
    log("request_received", {
      has_params: !!params,
      has_body: !!body,
      body_type: typeof body,
      has_headers: !!headers,
      has_db: !!db,
      has_services: typeof services === "function",
      has_memory: !!memory,
      has_gp: !!gp,
    });

    let { profile } = params || {};

    log("request_context", {
      profile: profile || null,
      has_x_secret: !!headers?.["x-secret"],
      has_raw_body: req.raw_body != null,
    });

    // 1. Verify webhook signature.
    let secret = process.env.RUSHBOX_SOCKET_SECRET;
    let supplied_signature = headers?.["x-secret"];

    if (!secret || !supplied_signature) {
      return fail("signature_credentials_missing", {
        ok: false,
        status: 401,
        message: "Socket webhook unauthorized",
      });
    }

    log("signature_credentials_present");

    // raw_body must contain the exact bytes/string signed by the sender.
    let raw_body = req.raw_body;

    if (typeof raw_body !== "string" && !Buffer.isBuffer(raw_body)) {
      return fail("raw_body_missing", {
        ok: false,
        status: 400,
        message: "Raw request body is required",
      });
    }

    log("raw_body_valid", {
      raw_body_type: Buffer.isBuffer(raw_body) ? "Buffer" : "string",
      raw_body_length: Buffer.byteLength(raw_body),
    });

    let expected_signature = crypto
      .createHmac("sha256", secret)
      .update(raw_body)
      .digest("hex");

    // Reject malformed signatures before timingSafeEqual.
    if (!/^[a-f0-9]{64}$/i.test(supplied_signature)) {
      return fail("signature_format_invalid", {
        ok: false,
        status: 401,
        message: "Socket webhook unauthorized",
      });
    }

    let expected = Buffer.from(expected_signature, "hex");
    let supplied = Buffer.from(supplied_signature, "hex");

    if (
      supplied.length !== expected.length ||
      !crypto.timingSafeEqual(expected, supplied)
    ) {
      return fail("signature_mismatch", {
        ok: false,
        status: 401,
        message: "Socket webhook unauthorized",
      });
    }

    log("signature_verified");

    // 2. Parse the event.
    let { payload: pload, event } = body || {};
    let { data: payload } = pload;
    debug(body);
    debug(payload);

    log("event_received", {
      event: event || null,
      has_payload: !!payload,
      payload_keys:
        payload && typeof payload === "object" ? Object.keys(payload) : [],
    });

    if (!payload || typeof event !== "string") {
      return fail("invalid_event_payload", {
        ok: false,
        status: 400,
        message: "Invalid webhook payload",
      });
    }

    let Socket_conn = await db.folder("Socket_conn");

    log("socket_connection_collection_ready");

    // 3. Record a newly established connection.
    if (event === "socket_connection") {
      let { connection_id } = payload;

      log("connection_event_processing", {
        profile: profile || null,
        connection_id: connection_id || null,
      });

      if (!profile || !connection_id) {
        return fail("connection_data_missing", {
          ok: false,
          status: 400,
          message: "Profile and connection ID are required",
        });
      }

      let db_result = await Socket_conn.updateOne(
        { _id: profile },
        {
          $set: {
            connection_id,
            updated_at: Date.now(),
          },
        },
        { upsert: true },
      );

      log("connection_persisted", {
        profile,
        connection_id,
        database_result: db_result ?? null,
      });

      await memory.set(profile, connection_id);

      log("connection_cached", {
        profile,
        connection_id,
      });

      return {
        ok: true,
      };
    }

    // 4. Remove a disconnected connection without erasing a newer one.
    if (event === "socket_disconnection") {
      let { connection_id } = payload;

      log("disconnection_event_processing", {
        profile: profile || null,
        connection_id: connection_id || null,
      });

      if (!profile || !connection_id) {
        return fail("disconnection_data_missing", {
          ok: false,
          status: 400,
          message: "Profile and connection ID are required",
        });
      }

      let db_result = await Socket_conn.updateOne(
        {
          _id: profile,
          connection_id,
        },
        {
          $unset: {
            connection_id: "",
          },
          $set: {
            updated_at: Date.now(),
          },
        },
      );

      log("connection_persistence_cleared_if_matching", {
        profile,
        connection_id,
        database_result: db_result ?? null,
      });

      let current_connection_id = await memory.get(profile);

      log("disconnection_cache_checked", {
        profile,
        disconnected_connection_matches_cache:
          current_connection_id === connection_id,
        has_cached_connection: !!current_connection_id,
      });

      if (current_connection_id === connection_id) {
        await memory.delete(profile);

        log("connection_cache_removed", {
          profile,
          connection_id,
        });
      } else {
        log("connection_cache_preserved", {
          profile,
          reason: "A different connection is currently cached",
        });
      }

      return {
        ok: true,
      };
    }

    if (event !== "socket_message") {
      return fail("unsupported_event", {
        ok: false,
        message: "Event not handled",
      });
    }

    // 5. Process a chat message.
    let { session: session_id, message } = payload;

    log("message_event_processing", {
      profile: profile || null,
      session_id: session_id || null,
      message_type: message === null ? "null" : typeof message,
      message_length: typeof message === "string" ? message.length : null,
    });

    if (!profile || !session_id || message == null) {
      return fail("message_data_missing", {
        ok: false,
        status: 400,
        message: "Profile, session and message are required",
      });
    }

    let ChatSessions = await db.folder("ChatSessions");

    log("chat_session_lookup_started", {
      session_id,
    });

    let chat = await ChatSessions.findOne({
      _id: session_id,
    });

    if (!chat) {
      return fail("chat_session_not_found", {
        ok: false,
        status: 404,
        message: "Chat session not found",
      });
    }

    log("chat_session_found", {
      session_id,
      has_user_id: !!chat.user_id,
      has_agent_id: !!chat.agent_id,
    });

    // Replace these checks if your session supports multiple participants
    // or uses a different participant/agent identity schema.
    let is_user = chat.user_id === profile;
    let is_agent = chat.assigned_agent_id === profile;

    log("participant_authorization_checked", {
      profile,
      session_id,
      is_user,
      is_agent,
      authorized: is_user || is_agent,
    });

    if (!is_user && !is_agent) {
      return fail("participant_unauthorized", {
        ok: false,
        status: 403,
        message: "Profile is not authorized for this chat session",
      });
    }

    let ChatMessages = await db.folder("ChatMessages");

    log("chat_message_collection_ready", {
      session_id,
    });

    let chat_message = {
      _id: crypto.randomUUID(),
      session_id,
      sender_type: is_user ? "user" : "agent",
      sender_id: profile,
      message,
      created_at: Date.now(),
    };

    log("chat_message_insert_started", {
      message_id: chat_message._id,
      session_id,
      sender_type: chat_message.sender_type,
      sender_id: profile,
    });

    await ChatMessages.insertOne(chat_message);

    log("chat_message_inserted", {
      message_id: chat_message._id,
      session_id,
    });

    await ChatSessions.updateOne(
      { _id: session_id },
      {
        $set: {
          last_message: chat_message._id,
          updated_at: Date.now(),
        },
      },
    );

    log("chat_session_updated", {
      session_id,
      last_message: chat_message._id,
    });

    // 6. Find the recipient's active connection.
    let recipient_profile = is_agent ? chat.user_id : chat.assigned_agent_id;

    log("recipient_resolved", {
      session_id,
      sender_profile: profile,
      recipient_profile: recipient_profile || null,
    });

    if (!recipient_profile) {
      log("recipient_missing", {
        session_id,
        message_id: chat_message._id,
      });

      return {
        ok: true,
        data: chat_message,
        delivery: {
          sent: false,
          reason: "Recipient profile is not configured",
        },
      };
    }

    let Sockets = await services("sockets");

    log("sockets_service_resolved", {
      has_call: typeof Sockets?.call === "function",
    });

    let connection_id = await memory.get(recipient_profile);

    log("recipient_cache_lookup", {
      recipient_profile,
      found: !!connection_id,
    });

    if (!connection_id) {
      log("recipient_database_lookup_started", {
        recipient_profile,
      });

      let connection = await Socket_conn.findOne({
        _id: recipient_profile,
      });

      connection_id = connection?.connection_id || null;

      log("recipient_database_lookup_completed", {
        recipient_profile,
        found: !!connection_id,
      });

      if (connection_id) {
        await memory.set(recipient_profile, connection_id);

        log("recipient_connection_cache_refreshed", {
          recipient_profile,
          connection_id,
        });
      }
    }

    if (!connection_id) {
      log("message_saved_recipient_offline", {
        session_id,
        message_id: chat_message._id,
        recipient_profile,
      });

      return {
        ok: true,
        data: chat_message,
        delivery: {
          sent: false,
          reason: "Recipient is not connected",
        },
      };
    }

    log("socket_emit_started", {
      event: "chat_message",
      session_id,
      message_id: chat_message._id,
      recipient_profile,
      connection_id,
    });

    debug(
      await Sockets.call("emit", {
        event: "chat.message.created",
        payload: JSON.stringify(chat_message),
        connection_id,
      }),
      "response",
    );

    log("socket_emit_completed", {
      event: "chat_message",
      session_id,
      message_id: chat_message._id,
      recipient_profile,
      connection_id,
    });

    return {
      ok: true,
      data: chat_message,
      delivery: {
        sent: true,
      },
    };
  } catch (error) {
    log("unhandled_error", {
      name: error?.name,
      message: error?.message,
      stack: error?.stack,
    });

    return {
      ok: false,
      status: 500,
      message: "Socket webhook processing failed",
    };
  }
};

export {
  paystack_webhook_events_listener,
  credit_wallet,
  courier_webhook,
  socket_webhook,
};
