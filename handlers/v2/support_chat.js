const create_chat_session = async (req) => {
  let { body, headers, db } = req;

  let { profile, platform } = headers;

  let user_id = profile?._id;

  let ChatSessions = await db.folder("ChatSessions");

  let session = {
    user_id,
    status: "active",
    assigned_agent_id: null,
    started_at: Date.now(),
    ended_at: null,
    last_message: null,
    last_message_at: null,
    _id: crypto.randomUUID(),
  };

  await ChatSessions.insertOne(session);

  // Send email notification to super admin
  const Aimail = await req.services("aimail");

  // Fetch user profile details if needed

  await Aimail.call("send_mail", {
    to: process.env.RUSHBOX_EMAIL,
    from: "Rushbox Support",
    content: {
      template: "support_chat_created",
      params: {
        session_id: session._id,
        user_id,
        started_at: session.started_at,
        fullname: profile?.fullname || null,
        email: profile?.email || null,
        phone: profile?.phone || null,
      },
    },
  });

  return {
    ok: true,
    message: "Chat session created",
    data: session,
  };
};

const get_chat_sessions = async (req) => {
  let { body, headers, db, query: qry } = req;

  let { page, limit } = qry;
  let { date } = body || {};

  let { profile } = headers;

  let user_id = profile?._id;

  if (!user_id) {
    return {
      ok: false,
      message: "User not authenticated",
      data: [],
    };
  }

  let skip = (page - 1) * limit;

  let query = {
    user_id,
  };

  if (date) {
    let start = new Date(`${date}T00:00:00.000`);
    let end = new Date(start);

    end.setDate(end.getDate() + 1);

    query.started_at = {
      $gte: start.getTime(),
      $lt: end.getTime(),
    };
  }

  let ChatSessions = await db.folder("ChatSessions");

  let sessions = await ChatSessions.find(query)
    .sort({ last_message_at: -1, started_at: -1 })
    .skip(skip)
    .limit(limit)
    .toArray();

  let total = await ChatSessions.countDocuments(query);

  return {
    ok: true,
    data: sessions,
    pagination: {
      page,
      pages: Math.ceil(total / limit),
      skip,
      limit,
      total,
    },
  };
};

const get_chat_session = async (req) => {
  let { body, headers, db } = req;

  let { session_id: _id } = body;

  let { profile } = headers;

  let user_id = profile?._id;

  let ChatSessions = await db.folder("ChatSessions");

  let session = await ChatSessions.findOne({
    _id,
    user_id,
  });

  return {
    ok: !!session,
    message: session ? "Chat session retrieved" : "Chat session not found",
    data: session,
  };
};

const get_chat_messages = async (req) => {
  let { body, headers, db, query: qry } = req;

  let { page, limit } = qry;
  let { session_id } = body || {};

  let { profile } = headers;

  let user_id = profile?._id;

  let ChatSessions = await db.folder("ChatSessions");

  let session = await ChatSessions.findOne({
    _id: session_id,
    $or: [{ user_id }, { assigned_agent_id: user_id }],
  });

  if (!session) {
    return {
      ok: false,
      message: "Chat session not found",
      data: [],
    };
  }

  let skip = (page - 1) * limit;

  let ChatMessages = await db.folder("ChatMessages");

  let messages = await ChatMessages.find({
    session_id,
  })
    .sort({ created_at: 1 })
    .skip(skip)
    .limit(limit)
    .toArray();

  let total = await ChatMessages.countDocuments({
    session_id,
  });

  return {
    ok: true,
    data: messages,
    pagination: {
      page,
      pages: Math.ceil(total / limit),
      skip,
      limit,
      total,
    },
  };
};

const send_chat_message = async (req) => {
  let { body, headers, db, services, memory, gp } = req;
  let { debug } = gp.utils;

  const log = (stage, data = {}) => {
    const entry = {
      scope: "send_chat_message",
      stage,
      timestamp: new Date().toISOString(),
      ...data,
    };

    if (typeof debug === "function") {
      debug(entry);
    } else {
      console.log("[send_chat_message]", entry);
    }
  };

  try {
    let { session_id, message } = body || {};
    let { profile } = headers || {};
    let user_id = profile?._id;

    let ChatSessions = await db.folder("ChatSessions");

    let session = await ChatSessions.findOne({
      _id: session_id,
      $or: [{ user_id }, { assigned_agent_id: user_id }],
    });

    if (!session) {
      return {
        ok: false,
        message: "Chat session not found",
        data: null,
      };
    }

    if (session.status !== "active") {
      return {
        ok: false,
        message: "Chat session is closed",
        data: null,
      };
    }

    let is_user = session.user_id === user_id;

    let ChatMessages = await db.folder("ChatMessages");
    let created_at = Date.now();

    let chat_message = {
      _id: crypto.randomUUID(),
      session_id,
      sender_type: is_user ? "user" : "agent",
      sender_id: user_id,
      message,
      created_at,
    };

    await ChatMessages.insertOne(chat_message);

    await ChatSessions.updateOne(
      { _id: session_id },
      {
        $set: {
          last_message: chat_message._id,
          updated_at: created_at,
        },
      },
    );

    // Resolve the other participant.
    const recipient_profile = is_user
      ? session.assigned_agent_id
      : session.user_id;

    let delivery = {
      sent: false,
      reason: null,
    };

    if (!recipient_profile) {
      delivery.reason = "Recipient profile is not assigned";
    } else {
      const Sockets = await services("sockets");

      let connection_id = await memory.get(recipient_profile);

      // Fall back to the persistent connection registry.
      if (!connection_id) {
        let SocketConn = await db.folder("Socket_conn");

        let connection = await SocketConn.findOne({
          _id: recipient_profile,
        });

        connection_id = connection?.connection_id || null;

        if (connection_id) {
          await memory.set(recipient_profile, connection_id);
        }
      }

      if (!connection_id) {
        delivery.reason = "Recipient is not connected";
      } else {
        const emit_result = await Sockets.call("emit", {
          event: "chat.message.created",
          payload: JSON.stringify(chat_message),
          connection_id,
        });

        if (emit_result?.ok === false) {
          delivery.reason = "Socket service rejected the emission";
        } else {
          delivery.sent = true;
        }
      }
    }
    return {
      ok: true,
      message: "Message saved",
      data: chat_message,
    };
  } catch (error) {
    return {
      ok: false,
      message: "Failed to send chat message",
      data: null,
    };
  }
};

const end_chat_session = async (req) => {
  let { body, headers, db } = req;

  let { session_id } = body;

  let { profile } = headers;

  let agent_id = profile?._id;

  let ChatSessions = await db.folder("ChatSessions");

  let session = await ChatSessions.findOne({
    _id: session_id,
  });

  if (!session) {
    return {
      ok: false,
      message: "Chat session not found",
      data: null,
    };
  }

  /*
   * Agent authorization should normally be
   * enforced by the route middleware.
   *
   * If you want the handler itself to enforce it,
   * check the agent collection here.
   */

  if (session.status === "closed") {
    return {
      ok: true,
      message: "Chat session already closed",
      data: session,
    };
  }

  let ended_at = Date.now();

  await ChatSessions.updateOne(
    {
      _id: session_id,
    },
    {
      $set: {
        status: "closed",
        ended_at,
      },
    },
  );

  session.status = "closed";
  session.ended_at = ended_at;

  /*
   * Emit:
   *
   * chat.session.closed
   *
   * {
   *   session_id
   * }
   */

  return {
    ok: true,
    message: "Chat session ended",
    data: session,
  };
};

/*
|--------------------------------------------------------------------------
| Chat Agents
|--------------------------------------------------------------------------
*/

const get_agent_chats = async (req) => {
  let { body, headers, db, query: qry } = req;

  let { limit, page } = qry;
  let { status } = body || {};

  let { profile } = headers;

  let agent_id = profile?._id;

  let skip = (page - 1) * limit;

  let query = {
    assigned_agent_id: agent_id,
  };

  if (status) {
    query.status = status;
  }

  let ChatSessions = await db.folder("ChatSessions");

  let chats = await ChatSessions.find(query)
    .sort({ last_message_at: -1, started_at: -1 })
    .skip(skip)
    .limit(limit)
    .toArray();

  let total = await ChatSessions.countDocuments(query);

  return {
    ok: true,
    data: chats,
    pagination: {
      page,
      pages: Math.ceil(total / limit),
      skip,
      limit,
      total,
    },
  };
};

/*
|--------------------------------------------------------------------------
| Support
|--------------------------------------------------------------------------
*/

// Super Agent.

const create_chat_agent = async (req) => {
  let { body, services } = req;

  let { fullname, email, password } = body || {};
  let Profile = await services("profiles");

  let res = await Profile.call("add_profile", {
    profile_type: process.env.ADMIN_PROFILE_TYPE,
    details: {
      email,
      fullname,
    },
    password,
  });

  return res;
};

const get_chat_agents = async (req) => {
  let { body, services, query } = req;

  let { limit, page } = query || {};
  let Profile = await services("profiles");

  let res = await Profile.call(`get_profiles?limit=${limit}&page=${page}`, {
    profile_type: process.env.ADMIN_PROFILE_TYPE,
    filter: {},
  });

  return res;
};

const get_support_chats = async (req) => {
  let { body, headers, db, query: qry } = req;

  let { page, limit } = qry;
  let { status } = body || {};

  let query = {};

  if (status) {
    query.status = status;
  }

  let skip = (page - 1) * limit;

  let ChatSessions = await db.folder("ChatSessions");

  let sessions = await ChatSessions.find(query)
    .sort({ last_message_at: -1, started_at: -1 })
    .skip(skip)
    .limit(limit)
    .toArray();

  let total = await ChatSessions.countDocuments(query);

  return {
    ok: true,
    data: sessions,
    pagination: {
      page,
      pages: Math.ceil(total / limit),
      skip,
      limit,
      total,
    },
  };
};

const assign_support_chat = async (req) => {
  let { body, headers, db, services } = req;
  let { platform } = headers;
  let { session_id, agent_id } = body || {};

  let Profile = await services("profiles");

  /*
   * Verify support agent.
   */
  let res = await Profile.call("get_profile", {
    profile_type: process.env.ADMIN_PROFILE_TYPE,
    _id: agent_id,
  });

  let agent = res?.ok && res.data;

  if (!agent) {
    return {
      ok: false,
      message: "Support agent not found or inactive",
      data: null,
    };
  }

  let ChatSessions = await db.folder("ChatSessions");

  let session = await ChatSessions.findOne({
    _id: session_id,
  });

  if (!session) {
    return {
      ok: false,
      message: "Chat session not found",
      data: null,
    };
  }

  if (session.status === "closed") {
    return {
      ok: false,
      message: "Cannot assign a closed chat session",
      data: null,
    };
  }

  /*
   * Retrieve the customer from the user_id
   * stored on the chat session.
   */
  let customerRes = await Profile.call("get_profile", {
    _id: session.user_id,
    profile_type: process.env.USER_PROFILE_TYPE,
  });

  let customer = customerRes?.ok ? customerRes.data : null;

  let assigned_at = Date.now();

  await ChatSessions.updateOne(
    {
      _id: session_id,
    },
    {
      $set: {
        assigned_agent_id: agent_id,
        assigned_at,
      },
    },
  );

  session.assigned_agent_id = agent_id;
  session.assigned_at = assigned_at;

  /*
   * Notify assigned agent.
   */
  const Aimail = await services("aimail");

  await Aimail.call("send_mail", {
    to: agent.email,
    from: "Rushbox Support",
    content: {
      template: "support_chat_assigned",
      params: {
        session_id,
        assigned_at,

        customer_name: customer?.fullname || null,
        customer_email: customer?.email || null,
        customer_phone: customer?.phone || null,

        platform: {
          name: platform.name,
        },
      },
    },
  });

  /*
   * Emit:
   *
   * chat.session.assigned
   *
   * {
   *   session_id,
   *   agent_id
   * }
   */

  return {
    ok: true,
    message: "Chat assigned",
    data: session,
  };
};

const agent_retrieve_order = async (req) => {
  let { body, headers, db } = req;

  let { session_id, order_id } = body || {};

  let { profile } = headers;

  let agent_id = profile?._id;

  /*
   * The agent must be assigned to this chat session.
   */
  let ChatSessions = await db.folder("ChatSessions");

  let session = await ChatSessions.findOne({
    _id: session_id,
    assigned_agent_id: agent_id,
  });

  if (!session) {
    return {
      ok: false,
      message: "Chat session not found or not assigned to this agent",
      data: null,
    };
  }

  /*
   * Resolve the order through the Orders service.
   *
   * The customer is taken from the chat session rather
   * than being supplied by the agent.
   */
  const Orders = await db.folder("Orders");

  let result = await Orders.findOne({
    _id: order_id,
    user_id: session.user_id,
  });

  if (!result?.ok || !result.data) {
    return {
      ok: false,
      message: "Order not found",
      data: null,
    };
  }

  return {
    ok: true,
    message: "Order retrieved",
    data: result.data,
  };
};

export {
  get_agent_chats,
  create_chat_session,
  get_chat_sessions,
  agent_retrieve_order,
  get_chat_session,
  get_chat_messages,
  send_chat_message,
  end_chat_session,
  create_chat_agent,
  get_chat_agents,
  get_support_chats,
  assign_support_chat,
};
