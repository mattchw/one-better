import type { NextConfig } from "next";
const config: NextConfig = { poweredByHeader: false, logging: { incomingRequests: { ignore: [/\/api\/calendar\/callback(?:\?|$)/, /\/auth\/chatgpt\/callback(?:\?|$)/] } } };
export default config;
