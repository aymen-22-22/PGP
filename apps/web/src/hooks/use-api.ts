import { useMutation, useQuery, useQueryClient, type UseQueryOptions } from '@tanstack/react-query';
import type { Paginated } from '@phone-erp/shared-types';
import { ApiRequestError, api, buildQuery } from '@/lib/api';

/** Typed GET hook. Keys are the path itself, so invalidation reads naturally. */
export function useApiQuery<T>(
  path: string,
  options?: Omit<UseQueryOptions<T, ApiRequestError>, 'queryKey' | 'queryFn'>,
) {
  return useQuery<T, ApiRequestError>({
    queryKey: [path],
    queryFn: () => api.get<T>(path),
    ...options,
  });
}

export function useApiList<T>(
  basePath: string,
  params: Record<string, unknown>,
  options?: Omit<UseQueryOptions<Paginated<T>, ApiRequestError>, 'queryKey' | 'queryFn'>,
) {
  const path = `${basePath}${buildQuery(params)}`;
  return useQuery<Paginated<T>, ApiRequestError>({
    queryKey: [path],
    queryFn: () => api.get<Paginated<T>>(path),
    placeholderData: (previous) => previous,
    ...options,
  });
}

/**
 * POST/PATCH hook that invalidates the given path prefixes on success, so a
 * receipt or a sale immediately refreshes every stock figure on screen.
 */
export function useApiMutation<TResult, TInput = void>(
  mutate: (input: TInput) => Promise<TResult>,
  invalidatePrefixes: string[] = [],
) {
  const queryClient = useQueryClient();
  return useMutation<TResult, ApiRequestError, TInput>({
    mutationFn: mutate,
    onSuccess: () => {
      for (const prefix of invalidatePrefixes) {
        void queryClient.invalidateQueries({
          predicate: (query) => String(query.queryKey[0] ?? '').startsWith(prefix),
        });
      }
    },
  });
}

export { api, buildQuery, ApiRequestError };
