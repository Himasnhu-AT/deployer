import { IBackendServerDetails } from "../backendServerDetails";
import { LbAlgorithm } from "../utils/enum";
import { ILbAlgorithm, ILBAlgorithmParams } from "./lb-algo.inference";

// Random Load Balancer Algorithm Class
export class RandomLB implements ILbAlgorithm {
  algoType = LbAlgorithm.RANDOM;

  allServers: IBackendServerDetails[];
  healthyServers: IBackendServerDetails[];
  curBEServerIdx: number;

  constructor(params: ILBAlgorithmParams) {
    this.allServers = params.allServers;
    this.healthyServers = params.healthyServers;
    this.curBEServerIdx = params.curBEServerIdx ?? -1;
  }

  //

  nextServer() {
    if (this.healthyServers.length === 0) {
      throw new Error("[ERROR] No Healthy Servers Found!!");
    }

    const randomDecimal = Math.random();
    const randomInRange = parseInt(
      (0 + randomDecimal * this.healthyServers.length).toString(),
    );

    this.curBEServerIdx = randomInRange % this.healthyServers.length;

    const server =
      this.healthyServers[this.curBEServerIdx % this.healthyServers.length];

    return { server, serverIdx: this.curBEServerIdx };
  }
}
