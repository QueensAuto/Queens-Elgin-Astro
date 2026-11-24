import { handleContact, type ContactEnv } from "../../worker/contact.ts";

export const onRequest = (ctx: { request: Request; env: ContactEnv }) =>
  handleContact(ctx.request, ctx.env);
