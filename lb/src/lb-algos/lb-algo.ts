import { LbAlgorithm } from "../utils/enum";
import { ILbAlgorithm, ILBAlgorithmParams } from "./lb-algo.inference";
import { RandomLB } from "./random";
import { RoundRobinLB } from "./rr";
import { WeightedRoundRobinLB } from "./wrr";

// Load Balancer Algorithm Factory Class
export class LbAlgorithmFactory {
  static factory(
    algoType: LbAlgorithm,
    params: ILBAlgorithmParams,
  ): ILbAlgorithm {
    switch (algoType) {
      case LbAlgorithm.RANDOM:
        return new RandomLB(params);

      case LbAlgorithm.ROUND_ROBIN:
        return new RoundRobinLB(params);

      case LbAlgorithm.WEIGHTED_ROUND_ROBIN:
        return new WeightedRoundRobinLB(params);

      default:
        throw new Error(`Didn\'t find implementation for algoType=${algoType}`);
    }
  }
}
