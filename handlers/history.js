import { ORDERS } from "../ds/folders.js";
import { authenticate_fez } from "./utils/couriers.js";

const get_courier_status = async (order) => {
  let status = "ongoing";
  let key;

  if (order.courier === "fez") {
    key = order.courier_key;
    if (!key) {
      let res = order.courier_response;
      let reskey = Object.keys(res.orderNos);
      key = res.orderNos[reskey[0]];
    }
    let auth = await authenticate_fez();
    try {
      const response = await fetch(
        `https://apisandbox.fezdelivery.co/v1/order/track/${key}`,
        {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${auth.authDetails.authToken}`,
            "secret-key": process.env.FEZ_TOKEN,
          },
        }
      );

      if (!response.ok) throw new Error(`HTTP error! ${response.status}`);

      const data = await response.json();
      if (data.status === "Success") {
        if (["Picked-Up", "Dispatched"].includes(data.order.orderStatus)) {
          status = "completed";
        }
      }
    } catch (err) {
      console.error("Error:", err);
    }
  } else if (order.courier === "dellyman") {
    let res = await fetch("https://dev.dellyman.com/api/v3.0/TrackOrder", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${process.env.DELLYMAN_TOKEN}`,
      },
      body: JSON.stringify({
        TrackingID: order.courier_response.TrackingID,
      }),
    });
    res = await res.json();
    if (res.OrderStatus === "PENDING") {
      status = status;
    } else if (res.OrderStatus === "ASSIGNED") {
      status = "completed";
    }
  } else if (order.courier === "kwik") {
    key = order.courier_key;
    if (!key) {
      key = order.courier_response.unique_order_id;
    }
    try {
      let response = await fetch(order.courier_response.job_status_check_link, {
        method: "GET",
      });

      if (!response.ok) throw new Error(`HTTP error! ${response.status}`);

      let data = await response.text();
      data = data.split(",");
      if (data[0] === "ARRIVED") {
        status = "completed";
      } else {
      }
    } catch (error) {
      console.error("Error:", error);
    }
  } else if (order.courier === "errandlr") {
  } else if (order.courier === "chowdeck") {
  } else if (order.courier === "kwikpik") {
    try {
      let res = await fetch(
        `https://api.kwikpik.io/partners/requests/${order.courier_key}`
      );
      res = await res.json();
      if (res.result) {
        if (res.result.request.status === "COMPLETED") {
          status = "completed";
        }
      }
    } catch (e) {}
  }

  return status;
};

const update_status = async (user_id, status) => {
  let Orders = await ORDERS(user_id);
  let ongoing = await Orders.index("ongoing");
  let ongoing_orders = await ongoing.read();

  let orders = [];
  for (let o = 0; o < ongoing_orders.length; o++) {
    let order = ongoing_orders[o];

    let stat = await get_courier_status(order);
    if (stat !== "ongoing") {
      if (stat === status) {
        order.status = stat;
        orders.push(order);
      }
      await Orders.update({ _id: order._id }, { status: stat });
    }
  }

  return orders;
};

const history = async (req, res) => {
  let { user_id, status, limit, cursor } = req.body;
  limit = limit || 20;

  let orders = [];

  if (!cursor) {
    orders = await update_status(user_id, status);
  }
  limit -= orders.length;

  if (limit > 0) {
    if (!cursor && orders.length) {
      cursor = orders[0]._id;
    }
    orders.push(
      ...(await (
        await (await ORDERS(user_id)).index(status)
      ).read(null, { limit, cursor }))
    );
  }

  res.json({
    ok: true,
    data: orders,
  });
};

export { history };
