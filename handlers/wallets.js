import { TRANSACTIONS, VIRTUAL_ACCOUNTS, WALLETS } from "../ds/folders.js";

const get_wallet = async (req, res) => {
  let { user_id } = req.params;

  let wallet = await (await WALLETS()).readone({ _id: user_id });
  if (!wallet) {
    return res.json({
      ok: false,
      message: "Wallet not found",
    });
  }
  wallet.virtual_account = await (
    await VIRTUAL_ACCOUNTS()
  ).readone({ _id: wallet.virtual_account });

  res.json({
    ok: !!wallet,
    message: wallet ? "Wallet fetched successfully" : "Wallet not found",
    data: wallet || null,
  });
};

const deduct = async (req, res) => {
  let { amount, wallet, reason } = req.body;
  amount = Math.abs(Number(amount));

  let Wallet = await WALLETS();
  let data = await Wallet.readone({ _id: wallet });
  if (!data || data.balance < amount) {
    return res.json({
      ok: false,
      message: !data ? "Wallet not found" : "Insufficient balance",
    });
  }

  await (
    await TRANSACTIONS()
  ).write({
    title: "Withdrawal",
    wallet,
    amount,
    misc: {
      reason,
    },
  });

  res.json({
    ok: true,
    message: "Balance updated succesfully",
    data: await Wallet.update(
      { _id: wallet },
      { balance: { $dec: Number(amount) } }
    ),
  });
};

const transactions = async (req, res) => {
  let { wallet, cursor } = req.body;

  let txs = await TRANSACTIONS();
  txs = await txs.index(wallet);

  let data = await txs.read(null, { cursor, limit: 20 });

  res.json({
    ok: true,
    message: "Transactions retrieved",
    data,
  });
};

export { get_wallet, transactions, deduct };
