import express from "express";
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

app.use("/admin/queues", serverAdapter.getRouter());

app.listen(3001, () => {
  console.log("Bull Board running on port 3001");
});