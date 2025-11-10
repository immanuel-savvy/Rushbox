import { hash } from "godprotocol/utils/hash.js";
import {
  generate_random_string,
  id_exists_,
  request_otp_,
  verify_otp_,
} from "./utils/user.js";
import { USERS, VIRTUAL_ACCOUNTS, WALLETS } from "../ds/folders.js";
import {
  create_customer,
  create_virtual_account,
  fetch_customer,
} from "./utils/payment_gateway.js";

const resend_otp = async (req, res) => {
  let { id } = req.body;

  id = id.trim();

  if (!(await id_exists_(id))) {
    return res.json({
      ok: false,
      message: "ID does not belong.",
    });
  }

  await request_otp_(id);

  res.json({
    ok: true,
    message: "OTP has been sent.",
  });
};

const verify_otp = async (req, res) => {
  let { id, otp } = req.body;
  id = id.trim();

  let result = verify_otp_(id, otp),
    message;
  if (result === "expired") message = "OTP have expired";
  else if (result) message = "OTP verification successful";
  else message = "OTP verification failed";

  let ok = message === "OTP verification successful";
  res.json({
    ok,
    message,
    data: (ok && (await id_exists_(id))) || null,
  });
};

const login = async (req, res) => {
  let { id } = req.body;
  id = id.trim();

  let exists = await id_exists_(id);
  if (!exists) {
    return res.json({
      ok: false,
      message: "User does not exists",
    });
  }

  await request_otp_(id);

  res.json({
    ok: true,
    message: "OTP has been sent",
  });
};

const signup = async (req, res) => {
  let user_data = req.body;

  let id = user_data.phone.trim(),
    response;
  let _id = hash(id),
    Users = await USERS();

  let email_check = await Users.findOne({ email: user_data.email });

  if (email_check)
    return res.json({
      ok: false,
      message: "Email have already been used",
    });

  user_data._id = _id;

  user_data.referral_code = generate_random_string(8, "alpha").toUpperCase();

  let customer = await fetch_customer(user_data.email),
    ans;

  try {
    ans = await Users.insertOne(user_data);
  } catch (error) {
    ans = { existed: true };
  }

  if (!ans.existed) {
    await request_otp_(id);

    if (!customer) {
      customer = await create_customer(user_data);
    }

    let response = await create_virtual_account(customer.customer_code);
    let virtual_account = {
      number: response.account_number,
      name: response.account_name,
      bank: response.bank,
      customer: customer.customer_code,
      user: _id,
      _id: hash(customer.customer_code || "xyz"),
    };
    try {
      await (await VIRTUAL_ACCOUNTS()).insertOne(virtual_account);
    } catch (e) {}

    let data = {
      _id,
      balance: 0,
      virtual_account: virtual_account._id,
    };
    await (await WALLETS()).replaceOne({ _id }, data, { upsert: true });
  }

  response = ans.existed
    ? {
        ok: false,
        message: "Phone has already been used.",
      }
    : {
        ok: true,
        message: "OTP sent successfully",
      };

  res.json(response);
};

export { verify_otp, login, signup, resend_otp, hash };
