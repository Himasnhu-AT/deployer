import express from "express";
import { BEHttpClient } from "./utils/http-client";
import { Server, IncomingMessage, ServerResponse } from "http";

import { HealthCheck } from "./utils/health-check";
import { Config } from "./utils/config";
import { LbAlgorithm } from "./utils/enum";
import { ILbAlgorithm } from "./lb-algos/lb-algo.inference";
import {
  BackendServerDetails,
  IBackendServerDetails,
} from "./backendServerDetails";
import { LbAlgorithmFactory } from "./lb-algos/lb-algo";

// Check if Config is Valid
Config.validate();
// Get Config Object
const CONFIG = Config.getConfig();

// Load Balancer Server Interface
export interface ILBServer {
  server: Server<typeof IncomingMessage, typeof ServerResponse>;

  algoType: LbAlgorithm;
  lbAlgo: ILbAlgorithm;

  hc: HealthCheck;
  backendServers: IBackendServerDetails[];

  /**
   * Returns HTTP Server to Express app
   */
  getLBServer(): Server<typeof IncomingMessage, typeof ServerResponse>;

  /**
   * Closes Express Server & returns Server Objecct
   */
  close(): Server<typeof IncomingMessage, typeof ServerResponse>;
}
// Load Balancer Server Class
export class LBServer implements ILBServer {
  hc: HealthCheck;
  lbAlgo: ILbAlgorithm;
  algoType: LbAlgorithm;

  backendServers: IBackendServerDetails[];
  server: Server<typeof IncomingMessage, typeof ServerResponse>;

  private PORT: number;
  private backendServerUrls: string[];
  private reqAbortController: AbortController;
  private healthyServers: IBackendServerDetails[];

  constructor(port?: number) {
    // Config.validate();

    this.PORT = port ?? CONFIG.lbPORT;
    this.algoType = CONFIG.lbAlgo;
    this.reqAbortController = new AbortController();
    this.healthyServers = new Array<IBackendServerDetails>();
    this.backendServers = new Array<IBackendServerDetails>();

    this.backendServerUrls = CONFIG.be_servers.map((e) => e.domain);

    CONFIG.be_servers.forEach((s) => {
      const beServer = new BackendServerDetails(
        s.domain,
        this.reqAbortController,
        s.weight,
      );
      this.backendServers.push(beServer);
    });

    this.lbAlgo = LbAlgorithmFactory.factory(this.algoType, {
      curBEServerIdx: -1,
      allServers: this.backendServers,
      healthyServers: this.healthyServers,
    });

    this.hc = new HealthCheck(this.backendServers, this.healthyServers);

    const app = this.createExpressApp();
    this.server = app.listen(this.PORT, () => {
      console.log("LB Server listening on port " + this.PORT);
    });

    this.server.on("error", (err: Error) => {
      console.log('[GlobalErrorEvent] => Server on "error" event triggered');
      console.error(err);
      // this.close();
    });

    this.server.on("close", () => {
      console.log('[GlobalCloseEvent] => Server on "close" event triggered');
      // this.close();
    });

    this.hc.performHealthCheckOnAllServers();
    this.hc.startHealthCheck();
  }

  // Create Express App
  private createExpressApp() {
    const app = express();

    app.use(express.text());
    app.use(express.json());

    app.get("/", async (req: express.Request, res: express.Response) => {
      if (this.healthyServers.length === 0) {
        return res.sendStatus(500);
      }

      let backendServer: IBackendServerDetails;

      try {
        backendServer = this.getBackendServer();
        console.log(`\t[BEStart]  -  ${backendServer.url}`);

        const response = await BEHttpClient.get(backendServer.url, {
          "axios-retry": {
            retries: CONFIG.be_retries,
            retryDelay: (retryCount) => retryCount * CONFIG.be_retry_delay,
            onRetry: (retryCount, error, requestConfig) => {
              console.log(
                `\t\t\t[BERetry]  -  retrying after delay ${backendServer.url}`,
              );

              // If connection establishment was refused
              // Need to perform Health Check on that perticular server
              // this could happen due BE Server being overloaded / is down
              if (error.code === "ECONNREFUSED")
                this.hc.performHealthCheck(backendServer);
              else
                console.log(
                  `${backendServer.url} - retryCount=${retryCount} - error=${error}`,
                );

              // get another server & make retry request to that server
              backendServer = this.getBackendServer();
              requestConfig.url = backendServer.url;
            },
          },
        });

        console.log(`\t[BESuccess]  -  ${backendServer.url}`);

        backendServer.incrementRequestsServedCount();
        return res.status(200).send(response.data);
      } catch (error) {
        console.log(
          `\t[BEError]  -  ${backendServer!?.url ?? "getBackendServer"}`,
        );
        console.error(error);
        res.sendStatus(500);
        return;
      }
    });

    return app;
  }

  public getLBServer(): Server<typeof IncomingMessage, typeof ServerResponse> {
    return this.server;
  }

  public close(): Server<typeof IncomingMessage, typeof ServerResponse> {
    this.hc.stopHealthCheck();
    this.reqAbortController.abort();

    const server = this.server.close();
    console.log(`Closed LB Server`);

    this.printBackendStats();

    return server;
  }

  private printBackendStats(): void {
    const stats: any[] = [];

    console.log("Backend Stats: ");
    this.backendServers.forEach((server) => {
      const stat = [
        server.url,
        server.totalRequestsServedCount,
        server.requestsServedCount,
        server.getStatus(),
      ];

      stats.push(stat);
      console.log(stat);
    });

    // console.log(`\n\nBackend Stats: \n${stats}`);
  }

  /**
   * This is the BackendServer Assignment function that returns the Backend Server Instance.
   * based on the LoadBalancing algorithm for sending incoming requests.
   */
  private getBackendServer(): IBackendServerDetails {
    const { server } = this.lbAlgo.nextServer();
    return server;
  }
}
