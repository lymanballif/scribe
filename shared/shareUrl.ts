/** Keep the server's public reader origin when the editor uses a private origin. */
export function resolveShareUrl(url: string, editorOrigin: string): string {
  const parsed = new URL(url, editorOrigin);
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new Error("Invalid public share URL");
  return parsed.href;
}
