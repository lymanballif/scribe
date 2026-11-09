import { createApp } from "./app";

// A dedicated entrypoint cannot silently become an editor if an env flag is lost.
const app = createApp(undefined, { publicReaderOnly: true });
const port = Number(process.env.PORT ?? 4872);
const host = process.env.HOST ?? "127.0.0.1";
app.listen(port, host, () => console.log(`public reader on ${host}:${port}`));
