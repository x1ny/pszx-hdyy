import { queryOptions } from "@tanstack/react-query";
import type { InferRequestType, InferResponseType } from "hono/client";
import { tripKeys } from "#/features/trip/queries.ts";
import { type ApiData, api, unwrap } from "#/shared/lib/api";

export type TripBatchOptionsInput = InferRequestType<
  typeof api.api.trip.batchOptions.$post
>["json"];
export type TripBatchOptions = ApiData<
  InferResponseType<typeof api.api.trip.batchOptions.$post>
>;
export type CreateBatchTripsValues = InferRequestType<
  typeof api.api.trip.createBatch.$post
>["json"];
export type CreateBatchTripsResult = ApiData<
  InferResponseType<typeof api.api.trip.createBatch.$post>
>;

const tripBatchKeys = {
  options: (input: TripBatchOptionsInput) =>
    [...tripKeys.all, "batch-options", input] as const,
};

export const tripBatchOptionsQueryOptions = (input: TripBatchOptionsInput) =>
  queryOptions({
    queryKey: tripBatchKeys.options(input),
    queryFn: () => unwrap(api.api.trip.batchOptions.$post({ json: input })),
  });

export const createBatchTrips = (values: CreateBatchTripsValues) =>
  unwrap(api.api.trip.createBatch.$post({ json: values }));
