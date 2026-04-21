export type LogisticsTri = boolean | null;

export type LogisticsRow = {
  outboundId: string;
  carrierId: string;
  trailerId: string;
  trailerType: string;
  outboundTypeId: string;
  transportationTypeId: string;
  live: LogisticsTri;
  completed: LogisticsTri;
  dispatch: string;
  plannedArrival: string;
  arrived: LogisticsTri;
  ignore: LogisticsTri;
};
