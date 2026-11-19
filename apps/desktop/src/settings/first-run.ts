/**
 * First run: a fresh install to a first answer in five minutes. What a gateway lists as models includes ones that do not
 * chat (speech, pictures, embeddings); a new person choosing their first model sees only the ones that do.
 */
const NOT_CHAT = /(^|[-_./:])(embed|embedding|embeddings|tts|whisper|transcribe|transcription|speech|audio|realtime|moderation|dall-e|image|images|imagen|rerank|reranker|davinci|babbage|vision-preview|omni-moderation|sora|veo)([-_./:]|\d|$)/i;

/** The models that answer in chat, in the order the gateway gave. When none look like chat models, all of them. */
export function chatModels(models: readonly string[]): string[] {
  const chat = models.filter((m) => !NOT_CHAT.test(m));
  return chat.length > 0 ? chat : [...models];
}
