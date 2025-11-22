// utils/tx.ts
export function generateTxNumber(): string {
  // timestamp + random + small salt to avoid sequential look
  const t = Date.now().toString(36);
  const r = Math.floor(Math.random() * 1e6).toString(36);
  return `TX-${t}-${r}`;
}
