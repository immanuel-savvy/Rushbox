const services = async (services_, gp) => {
  if (!gp.utils.validateService(["profiles", "aimail"], services_)) return;

  let { profiles, aimail, sockets } = services_;

  return {
    profiles: {
      api_version: "v3",
      uri: profiles.uri,
      local: profiles.local,
      url: profiles.url,
      profile_key: profiles.profile_key,
      api_key: profiles.api_key,
    },
    aimail: {
      api_version: "v3",
      uri: aimail.uri,
      local: aimail.local,
      url: aimail.url,
      profile_key: aimail.profile_key,
      api_key: aimail.api_key,
    },
    sockets: {
      api_version: "v1",
      uri: sockets.uri,
      local: sockets.local,
      url: sockets.url,
      profile_key: sockets.profile_key,
      api_key: sockets.api_key,
    },
  };
};

export default services;
