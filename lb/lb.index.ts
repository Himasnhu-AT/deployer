import path from "path";
import { LBServer } from "./src/loadbalancer";

(globalThis as any).__appBaseDir = path.resolve(__dirname);

// Start Load Balancer Server
let lbserver: LBServer;
try {
  const port = parseInt(process.argv[2]);
  console.log(port);
  lbserver = new LBServer(port);
} catch (err) {
  console.error("Invalid port provided");
  process.exit(1);
}

// Handle Signals
// process.on("SIGTERM", () => {
//   console.info("SIGTERM signal received.");
//   lbserver.close();
// });

// process.on("SIGINT", () => {
//   console.info("SIGINT signal received.");
//   lbserver.close();
// });
