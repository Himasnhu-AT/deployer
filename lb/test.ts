import { spawn } from "child_process";
import axios from "axios";

// Helper to spawn a process and log output
function startProcess(command: string, args: string[]) {
  const proc = spawn(command, args, { stdio: "inherit" });
  return proc;
}

// Start backend servers
console.log("Starting backend servers...");
const bePorts = [8081, 8082, 8083];
const beProcs = bePorts.map((port) =>
  startProcess("npx", ["ts-node", "be.index.ts", port.toString()]),
);

// Wait for backends to start
function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  await sleep(2000);

  // Start load balancer
  console.log("Starting load balancer...");
  const lbProc = startProcess("npx", [
    "ts-node",
    "--files",
    "lb.index.ts",
    "90",
  ]);

  // Wait for LB to start and health checks to complete
  await sleep(3000);

  // Stress test parameters
  const TOTAL_REQUESTS = 10000;
  const CONCURRENCY = 2000;

  let successes = 0;
  let failures = 0;
  let latencies: number[] = [];

  console.log(
    `Sending ${TOTAL_REQUESTS} requests to load balancer with concurrency ${CONCURRENCY}...`,
  );

  let inFlight = 0;
  let sent = 0;

  function sendRequest(): Promise<void> {
    const start = Date.now();
    return axios
      .get("http://localhost:90/")
      .then(() => {
        successes++;
        latencies.push(Date.now() - start);
      })
      .catch(() => {
        failures++;
      });
  }

  async function runStressTest() {
    return new Promise<void>((resolve) => {
      function next() {
        while (inFlight < CONCURRENCY && sent < TOTAL_REQUESTS) {
          inFlight++;
          sent++;
          sendRequest().finally(() => {
            inFlight--;
            if (sent < TOTAL_REQUESTS) {
              next();
            } else if (inFlight === 0) {
              resolve();
            }
          });
        }
      }
      next();
    });
  }

  await runStressTest();

  // Print stats
  const avgLatency = latencies.length
    ? (latencies.reduce((a, b) => a + b, 0) / latencies.length).toFixed(2)
    : "N/A";
  console.log(`\nResults:`);
  console.log(`  Successes: ${successes}`);
  console.log(`  Failures: ${failures}`);
  console.log(`  Average latency: ${avgLatency} ms`);

  // Cleanup: kill all started processes
  console.log("Stopping servers...");
  lbProc.kill();
  beProcs.forEach((proc) => proc.kill());

  await sleep(1000);
  console.log("Done.");
}

main();
