import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import { fileURLToPath } from "url";
import path from "path";

import dotenv from "dotenv";
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// import rushbox from "./machines/rushbox.js";

import router from "./routes.js";
import { hash } from "godprotocol/utils/hash.js";
import test_router from "./tests/routes.js";

const app = express();

app.use(cors());
app.use(express.static(`${__dirname}/assets`));
app.use(bodyParser.urlencoded({ extended: true, limit: "100mb" }));
app.use(bodyParser.json({ limit: "100mb" }));

app.get("/", (req, res) => {
  res.send("Welcome to Rushbox API");
});

router(app);
test_router(app);

// let manager = await rushbox({ __dirname, app });

// export default manager.handler;
export default app;
// export { manager };
