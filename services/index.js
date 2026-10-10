const services = async (services_, gp) => {
  if (!gp.utils.validateService(["profiles", "aimail"], services_)) return;

  let { profiles, aimail } = services_;

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
  };
};

export default services;
