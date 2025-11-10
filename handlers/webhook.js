import crypto from "crypto";
import {
  EVENT_LOGS,
  TRANSACTIONS,
  VIRTUAL_ACCOUNTS,
  WALLETS,
} from "../ds/folders.js";
import { hash } from "./auth.js";

const paystack_webhook_events_listener = async (req, res) => {
  let { body } = req;
  let hash_ = crypto
    .createHmac("sha512", process.env.PAYSTACK_SECRET)
    .update(JSON.stringify(body))
    .digest("hex");

  // let Ev_logs = await EVENT_LOGS();
  // try {
  //   await Ev_logs.write({
  //     hash_,
  //     phash: req.headers["x-paystack-signature"],
  //     whatis: "HAPPENING",
  //     body,
  //   });
  // } catch (e) {
  //   await Ev_logs.write({ m: e.message });
  // }

  if (hash_ === req.headers["x-paystack-signature"]) {
    // await Ev_logs.write({ inside: "yes?" });

    // await Ev_logs.write({ body, in_here: true });
    if (body.event === "charge.success") {
      // await Ev_logs.write({ body, charge_success: true });
      let customer = body.data.customer;
      let customer_hash = hash(customer.customer_code);
      // console.log(await Ev_logs.write({ customer_hash }));
      let virtual_account = await (
        await VIRTUAL_ACCOUNTS()
      ).readone({ _id: customer_hash });
      if (virtual_account) {
        let value = body.data.amount / 100;

        // await Ev_logs.write({ virtual_account, got_here: true });
        await (
          await WALLETS()
        ).update({ _id: virtual_account.user }, { balance: { $inc: value } });

        let authorization = body.data.authorization;
        let ress = await (
          await TRANSACTIONS()
        ).write({
          title: "Top-up",
          amount: value,
          wallet: virtual_account.user,
          misc: {
            from: {
              bank: authorization.bank,
              sender_name: authorization.sender_name,
              account: authorization.sender_bank_account_number,
            },
          },
        });
        // await Ev_logs.write({ ress, after_here: true });
      }
    }
    res.send(200);
  } else res.send(403);
};

export { paystack_webhook_events_listener };
