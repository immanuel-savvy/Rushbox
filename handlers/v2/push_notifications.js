const register_push_token = async (req) => {
  const { db, headers, body } = req;
  const { profile } = headers;

  const { token, platform, device_id } = body;

  const Devices = await db.folder("Devices");

  const now = Date.now();

  const existing = await Devices.findOne({
    token,
  });

  if (existing) {
    await Devices.updateOne(
      {
        _id: existing._id,
      },
      {
        $set: {
          profile: profile._id,
          platform: platform || existing.platform,
          device_id: device_id || existing.device_id,
          active: true,
          updated: now,
        },
      },
    );

    return {
      ok: true,
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
    message: "Push token registered",
    data: {
      _id,
      token,
    },
  };
};

export { register_push_token };
