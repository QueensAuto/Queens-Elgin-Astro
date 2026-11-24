import { handleBooking, type BookingEnv } from "../../worker/booking.ts";

export const onRequest = (ctx: { request: Request; env: BookingEnv }) =>
  handleBooking(ctx.request, ctx.env);
