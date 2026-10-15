const services_config = {
  profiles: {
    url: process.env.DEV //&& false
      ? "http://localhost:4000"
      : "https://profile-api.savvyaisolution.com",
    uri: "profiles.savvyaisolution.com",
    api_key: process.env.API_KEY,
  },
  aimail: {
    url: process.env.DEV
      ? "http://localhost:4003"
      : "https://email-api.savvyaisolution.com",
    uri: "aimail.savvyaisolution.com",
    profile_key: process.env.AIMAIL_PROFILE_KEY,
  },
  sockets: {
    url: process.env.DEV
      ? "http://localhost:5101"
      : "https://sockets.rushbox.biz",
    uri: "sockets.savvyaisolution.com",
    profile_key: process.env.SOCKETS_PROFILE_KEY,
  },
};

const gp_services_config = {
  identity: {
    url: process.env.DEV //&& false
      ? "http://localhost:4000"
      : "https://profile-api.savvyaisolution.com",
    uri: "profiles.savvyaisolution.com",
    api_key: process.env.API_KEY,
  },
};

export default services_config;
export { gp_services_config };
