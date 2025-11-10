import { hash } from "godprotocol/utils/hash.js";

const user = async (req, res) => {
  let domain = `http://${req.headers.host}`;
  let headers = {
    "Content-Type": "application/json",
  };
  let { id } = req.query;
  console.log("Fetching test user...", domain);
  fetch(`${domain}/user/${hash(id)}`, {
    method: "GET",
    headers,
  })
    .then((d) => d.json())
    .then((ress) => {
      console.log(ress);
      res.json(ress);
    });
};

const update_profile = async (req, res) => {
  let domain = `http://${req.headers.host}`;
  let headers = {
    "Content-Type": "application/json",
  };
  console.log("Updating test user...", domain);

  let property = req.query.property,
    value = req.query.value,
    id = req.query.id;

  fetch(`${domain}/update_profile`, {
    method: "post",
    headers,
    body: JSON.stringify({
      property,
      value,
      _id: hash(id),
    }),
  })
    .then((d) => d.json())
    .then((r) => {
      console.log(r);
      res.json(r);
    })
    .catch((e) => console.log(e));
};

export { user, update_profile };
