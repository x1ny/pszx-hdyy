import { keepPreviousData, queryOptions } from "@tanstack/react-query";
import type { InferRequestType, InferResponseType } from "hono/client";
import { type ApiData, api, unwrap } from "#/shared/lib/api";

export type TripListData = ApiData<
  InferResponseType<typeof api.api.trip.list.$post>
>;
export type Trip = TripListData["list"][number];
export type TripFilters = InferRequestType<
  typeof api.api.trip.list.$post
>["json"];
export type TripFormValues = InferRequestType<
  typeof api.api.trip.create.$post
>["json"];
export type TripOptions = ApiData<
  InferResponseType<typeof api.api.trip.options.$post>
>;

export const tripKeys = {
  all: ["trip"] as const,
  list: (filters: TripFilters) => [...tripKeys.all, "list", filters] as const,
  options: (activityId: number) =>
    [...tripKeys.all, "options", activityId] as const,
  member: (memberId: number) => [...tripKeys.all, "member", memberId] as const,
};

export const tripListQueryOptions = (filters: TripFilters) =>
  queryOptions({
    queryKey: tripKeys.list(filters),
    queryFn: () => unwrap(api.api.trip.list.$post({ json: filters })),
    placeholderData: keepPreviousData,
  });

export const tripOptionsQueryOptions = (activityId: number) =>
  queryOptions({
    queryKey: tripKeys.options(activityId),
    queryFn: () => unwrap(api.api.trip.options.$post({ json: { activityId } })),
  });

export const memberTripListQueryOptions = (memberId: number) =>
  queryOptions({
    queryKey: tripKeys.member(memberId),
    queryFn: () =>
      unwrap(api.api.trip.listByMember.$post({ json: { memberId } })),
  });

export const createTrip = (values: TripFormValues) =>
  unwrap(api.api.trip.create.$post({ json: values }));

export const updateTrip = (values: TripFormValues & { id: number }) =>
  unwrap(api.api.trip.update.$post({ json: values }));

export const deleteTrip = (id: number) =>
  unwrap(api.api.trip.delete.$post({ json: { id } }));
