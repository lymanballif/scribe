import type { RequestHandler } from "express";
/** Optional separate public reader process: closed allowlist, no editor or author APIs. */
export const publicReaderOnly: RequestHandler = (req, res, next) => {
  const read = req.method === "GET" || req.method === "HEAD";
  const share = /^\/s\/[a-z0-9]{6,32}\/?$/.test(req.path);
  const shareApi = /^\/api\/shares\/[a-z0-9]{6,32}$/.test(req.path);
  const comments = /^\/api\/shares\/[a-z0-9]{6,32}\/comments$/.test(req.path);
  const image = /^\/i\/[a-f0-9]{24,64}\.(webp|jpg|png|gif)$/.test(req.path);
  const asset = /^\/assets\/[A-Za-z0-9._-]+$/.test(req.path);
  const icon = /^\/(apple-touch-icon|icon-192|icon-512|icon-maskable-512)\.png$/.test(req.path);
  if ((read && (share || shareApi || comments || image || asset || icon)) || (req.method === "POST" && comments)) return next();
  res.set("Cache-Control", "no-store").status(404).type("text").send("Not found");
};
