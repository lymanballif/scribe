import { createApp } from "./app";

const app = createApp();
const port = Number(process.env.PORT ?? 4871);
app.listen(port, () => console.log(`write server on http://localhost:${port}`));
