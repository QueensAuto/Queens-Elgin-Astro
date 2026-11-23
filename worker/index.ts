import { handleBooking, type BookingEnv } from "./booking";

/**
 * Standalone Worker bound only to queensautoserviceselgin.com/api/booking*
 * (see worker/wrangler.jsonc). The rest of the site is served as before.
 */
export default {
  async fetch(request: Request, env: BookingEnv): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname === "/api/booking" || pathname === "/api/booking/") {
      return handleBooking(request, env);
    }
    return new Response("Not found", { status: 404 });
  },
};
