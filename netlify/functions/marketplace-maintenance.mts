import type { Config } from "@netlify/functions";
import { netlifyContext } from "../../server/runtime";
import { expireUnpaid } from "../../server/marketplace/orders";
import { reconcilePayments } from "../../server/marketplace/payments";
import { cleanUploads } from "../../server/marketplace/storage";
export default async () => {
  const ctx = netlifyContext();
  if (Netlify.env.get("CARDANOMIX_ENVIRONMENT") !== "production") return;
  const expired = await expireUnpaid(ctx),
    checked = await reconcilePayments(ctx),
    removed = await cleanUploads(ctx);
  console.log(JSON.stringify({ expired, checked, removed }));
};
export const config: Config = { schedule: "*/2 * * * *" };
