const signup = async (req, res) => {
  let domain = `http://${req.headers.host}`;
  let headers = {
    "Content-Type": "application/json",
  };
  console.log("Signing up test user...", domain);
  fetch(`${domain}/signup`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      phone: "2349074991735",
      firstname: "Immanuel",
      lastname: "Savvy",
      email: "immanuelsavvy@gmail.com",
      birthday: "04/08/2025",
      referee: "UPHAWZOA",
    }),
  })
    .then((d) => d.json())
    .then((ress) => {
      console.log(ress);
      res.json(ress);
    });
};

export { signup };
