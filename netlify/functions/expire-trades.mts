import type { Config } from "@netlify/functions";
import { netlifyContext } from "../../server/runtime";
import { expireOverdueTrades } from "../../server/trades";

/** Bricht Trades ab, bei denen die Zahlungsfrist samt Gnadenfrist abgelaufen ist. */
export default async () => {
  const cancelled = await expireOverdueTrades(netlifyContext());
  if (cancelled > 0) console.log(`${cancelled} überfällige Trades abgebrochen`);
};

export const config: Config = {
  schedule: "*/5 * * * *",
};
