//#region src/experimental/forever.ts
console.warn(
  "[@cloudflare/ai-chat/experimental/forever] WARNING: You are using an experimental API that WILL break between releases. Do not use in production."
);
function withDurableChat(Base) {
  class DurableChatAgent extends Base {}
  return DurableChatAgent;
}
//#endregion
export { withDurableChat };

//# sourceMappingURL=forever.js.map
