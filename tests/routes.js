import { signup } from "./auth.js";
import { update_profile, user } from "./user.js";

const test_router = async (app) => {
  app.get("/test-signup", signup);
  app.get("/test-user", user);
  app.get("/test-update-profile", update_profile);
};

export default test_router;
