import type { Config } from "@netlify/functions";
import { createApp } from "../../server/app";
import { netlifyContext } from "../../server/runtime";

let handle: ((request: Request) => Promise<Response>) | null = null;

export default async (request: Request) => {
  handle ??= createApp(netlifyContext());
  return handle(request);
};

export const config: Config = {
  path: "/api/*",
  rateLimit: {
    windowLimit: 300,
    windowSize: 60,
    aggregateBy: ["ip", "domain"],
  },
};
