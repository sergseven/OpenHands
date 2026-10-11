import React from "react";
import {
  QueryClient,
  QueryClientProvider,
  useInfiniteQuery,
} from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { paginatedConversationsQueryKey } from "#/hooks/query/use-paginated-conversations";

vi.mock("#/contexts/active-backend-context", async () => {
  const actual = await vi.importActual<
    typeof import("#/contexts/active-backend-context")
  >("#/contexts/active-backend-context");
  return {
    ...actual,
    useActiveBackend: () => ({
      backend: { id: "b1", kind: "local" },
      orgId: null,
    }),
  };
});

import { useLatestRuntimeAcpModels } from "#/hooks/use-latest-runtime-acp-models";

const renderWith = (queryClient: QueryClient) =>
  renderHook(() => useLatestRuntimeAcpModels("claude-code"), {
    wrapper: ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
  });

describe("useLatestRuntimeAcpModels", () => {
  it("reads the sidebar's cached conversations page", () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(paginatedConversationsQueryKey(20, "b1", null), {
      pages: [
        {
          items: [
            {
              acp_server: "claude-code",
              available_models: [{ model_id: "opus", name: "Opus 5.5" }],
            },
          ],
          next_page_id: null,
        },
      ],
      pageParams: [undefined],
    });

    const { result } = renderWith(queryClient);

    expect(result.current).toEqual([{ model_id: "opus", name: "Opus 5.5" }]);
  });

  it("never fetches: an empty cache stays empty", () => {
    const queryClient = new QueryClient();
    const fetchSpy = vi.spyOn(queryClient, "fetchQuery");

    const { result } = renderWith(queryClient);

    expect(result.current).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
    // Reading the cache must not even create the query.
    expect(
      queryClient.getQueryState(paginatedConversationsQueryKey(20, "b1", null)),
    ).toBeUndefined();
  });

  it("does not hijack the sidebar query: its refetches still use the sidebar's queryFn", async () => {
    // Regression: a second observer registered with ``enabled: false`` and no
    // ``queryFn`` replaced the shared query's options, so the sidebar's next
    // refetch failed with "No queryFn was passed".
    const queryClient = new QueryClient();
    const key = paginatedConversationsQueryKey(20, "b1", null);
    const sidebarQueryFn = vi.fn(async () => ({
      items: [
        {
          acp_server: "claude-code",
          available_models: [{ model_id: "opus", name: "Opus 5.5" }],
        },
      ],
      next_page_id: null,
    }));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { result } = renderHook(
      () => {
        useInfiniteQuery({
          queryKey: key,
          queryFn: sidebarQueryFn,
          initialPageParam: undefined as string | undefined,
          getNextPageParam: () => undefined,
        });
        return useLatestRuntimeAcpModels("claude-code");
      },
      {
        wrapper: ({ children }: { children: React.ReactNode }) => (
          <QueryClientProvider client={queryClient}>
            {children}
          </QueryClientProvider>
        ),
      },
    );

    await waitFor(() =>
      expect(result.current).toEqual([{ model_id: "opus", name: "Opus 5.5" }]),
    );
    await queryClient.invalidateQueries({ queryKey: key });

    expect(sidebarQueryFn).toHaveBeenCalledTimes(2);
    expect(queryClient.getQueryState(key)?.status).toBe("success");
    expect(
      errorSpy.mock.calls.some((args) => String(args[0]).includes("queryFn")),
    ).toBe(false);
    errorSpy.mockRestore();
  });
});
