const result = (data) => {
  return data.status === true ? data.data : null;
};

const create_virtual_account = async (customer) => {
  let payload = {
      customer,
      preferred_bank: "wema-bank",
    },
    res;

  try {
    res = await fetch("https://api.paystack.co/dedicated_account", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.PAYSTACK_SECRET}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    res = await res.json();
  } catch (e) {
    console.log(e);
  }

  return result(res);
};

const create_customer = async (user) => {
  let payload = {
      email: user.email,
      first_name: user.firstname,
      last_name: user.lastname,
      phone: `+${user.phone}`,
    },
    data;

  try {
    let response = await fetch("https://api.paystack.co/customer", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.PAYSTACK_SECRET}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    data = await response.json();
  } catch (error) {
    console.error("Error:", error);
  }

  return result(data);
};

const fetch_customer = async (email) => {
  let data;
  try {
    let response = await fetch(`https://api.paystack.co/customer/${email}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${process.env.PAYSTACK_SECRET}`,
      },
    });

    data = await response.json();
  } catch (error) {
    console.error("Error:", error);
  }

  return result(data);
};

const update_customer = async (customer, update) => {
  let data;
  try {
    let response = await fetch(`https://api.paystack.co/customer/${customer}`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${process.env.PAYSTACK_SECRET}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(update),
    });

    data = await response.json();
  } catch (e) {}

  return result(data);
};

export {
  create_virtual_account,
  create_customer,
  fetch_customer,
  update_customer,
};
