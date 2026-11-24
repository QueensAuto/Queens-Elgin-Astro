import { handleVoice, type VoiceEnv } from "../../../worker/voice.ts";

export const onRequest = (ctx: { request: Request; env: VoiceEnv }) =>
  handleVoice(ctx.request, ctx.env);
