import Repos from "@godprotocol/repositories";
import trinity from "godprotocol";
import Oracle from "godprotocol/Objects/Oracle.js";

const init = async ({ __dirname, app }) => {
  let manager_server = {
    hostname: !process.env.LOCALHOST ? "rushbox.onrender.com" : "127.0.0.1",
  };
  if (process.env.LOCALHOST) {
    manager_server.port = process.env.PORT;
  }

  let oracle = new Oracle(
    process.env.LOCALHOST
      ? { hostname: "127.0.0.1", port: 1909 }
      : { hostname: "immanuel-oracle.onrender.com" },
    { manager_key: process.env.MANAGER_KEY }
  );
  await oracle.sync(
    manager_server,
    Repos,
    process.env.LOCALREPO
      ? {
          repo: {
            type: "remote",
            url: `http://127.0.0.1:4444/Rushbox-repo`,
          },
        }
      : {
          repo: {
            type: "mongo",
            db_url: process.env.MONGODB_URI,
            db_name: "Rushbox-repo11",
          },
        }
  );

  let mgr = await trinity.add_manager("immanuel", {
    oracle: oracle,
    server: manager_server,
    init_account: { name: "Rushbox", password: process.env.RUSHPASSWORD },
    app,
  });

  // await oracle.add_repo({
  //   repo: {
  //     type: "fs",
  //     options: {
  //       __dirname: `${__dirname}/${mgr.path}`,
  //       // remote: oracle_server,
  //       name: "fs01408",
  //     },
  //   },
  // });

  // await oracle.add_repo({
  //   repo: {
  //     type: "github",
  //     options: {
  //       key: process.env.RUSHBABY_GH,
  //       username: "immanuel-savvy",
  //       repo: "Rushbox-mgr",
  //     },
  //   },
  // });

  // await oracle.add_repo({
  //   filter: `^(\.oracle|\.codes)`,
  //   repo: {
  //     type: "github",
  //     options: {
  //       key: process.env.IMMANUEL_GH,
  //       username: "immanuel-savvy",
  //       repo: "Immanuel",
  //     },
  //   },
  // });

  return mgr;
};

export default init;
