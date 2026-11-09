import { createApp } from "./app";

const app = createApp();
const port = Number(process.env.PORT ?? 4871);
const host = process.env.HOST;
// Set HOST to the verified private/loopback interface behind the private proxy.
if (host) app.listen(port, host, () => console.log(`write server on ${host}:${port}`));
else app.listen(port, () => console.log(`write server listening on port ${port}`));
