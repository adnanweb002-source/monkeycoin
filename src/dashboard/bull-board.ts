import express from "express";
import basicAuth from "express-basic-auth";
import { createBullBoard } from "@bull-board/api";
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter";
import { ExpressAdapter } from "@bull-board/express";
import { Queue } from "bullmq";

const app = express();

const serverAdapter = new ExpressAdapter();
serverAdapter.setBasePath("/admin/queues");

const mailQueue = new Queue("mail-queue", {
  connection: {
    host: "redis",
    port: 6379,
  },
});

createBullBoard({
  queues: [new BullMQAdapter(mailQueue)],
  serverAdapter,
});

const boardRouter = serverAdapter.getRouter();
const user = process.env.BULL_BOARD_USER;
const pass = process.env.BULL_BOARD_PASSWORD;

if (user && pass) {
  app.use(
    "/admin/queues",
    basicAuth({
      users: { [user]: pass },
      challenge: true,
    }),
    boardRouter,
  );
} else {
  console.warn(
    "[bull-board] BULL_BOARD_USER and BULL_BOARD_PASSWORD not set; /admin/queues is not authenticated. Set both env vars in production.",
  );
  app.use("/admin/queues", boardRouter);
}

const host = process.env.BULL_BOARD_HOST || "0.0.0.0";
const port = Number(process.env.BULL_BOARD_PORT || 3001);

app.listen(port, host, () => {
  console.log(`Bull Board listening on http://${host}:${port}/admin/queues`);
});