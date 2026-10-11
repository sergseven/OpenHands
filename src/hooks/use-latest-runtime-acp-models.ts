import { useCallback, useSyncExternalStore } from "react";
import { type InfiniteData, useQueryClient } from "@tanstack/react-query";
import { useActiveBackend } from "#/contexts/active-backend-context";
import {
  PAGINATED_CONVERSATIONS_DEFAULT_LIMIT,
  paginatedConversationsQueryKey,
} from "#/hooks/query/use-paginated-conversations";
import type {
  AcpRuntimeModel,
  AppConversationPage,
} from "#/api/conversation-service/agent-server-conversation-service.types";
import type { ACPModelOption } from "#/constants/acp-providers";

/**
 * Map a runtime ACP model list to picker rows. ``description`` is kept: for
 * aliases such as claude-agent-acp's ``default`` / ``opus`` it is the only
 * place the server says which concrete model the alias means.
 */
export function toAcpModelOptions(
  models: readonly AcpRuntimeModel[],
): ACPModelOption[] {
  return models.map((model) => ({
    id: model.model_id,
    label: model.name ?? model.model_id,
    ...(model.description ? { description: model.description } : {}),
  }));
}

/**
 * The runtime model list of the most recently updated conversation run by
 * ``acpServerKey`` that reported one. Pages are ordered newest first (the
 * search sorts by ``updated_at`` desc); conversations whose session never
 * reported a list are skipped. Empty when there is none.
 */
export function pickLatestRuntimeAcpModels(
  pages: readonly Pick<AppConversationPage, "items">[] | undefined,
  acpServerKey: string | null | undefined,
): AcpRuntimeModel[] {
  if (!pages || !acpServerKey) return [];
  for (const page of pages) {
    for (const conversation of page.items) {
      if (
        conversation.acp_server === acpServerKey &&
        conversation.available_models?.length
      ) {
        return conversation.available_models;
      }
    }
  }
  return [];
}

/**
 * Home screen (no session yet): the last live model list the provider
 * reported, read from the sidebar's conversations query. Subscribes to the
 * query cache instead of registering a query observer: an observer here would
 * share the sidebar's query and replace its options (an observer without a
 * ``queryFn`` breaks the sidebar's refetches), and calling
 * ``usePaginatedConversations`` would pull its routing/auth gates into the
 * chat input. Never fetches.
 */
export function useLatestRuntimeAcpModels(
  acpServerKey: string | null | undefined,
): AcpRuntimeModel[] {
  const queryClient = useQueryClient();
  const { backend, orgId } = useActiveBackend();
  const queryKey = paginatedConversationsQueryKey(
    PAGINATED_CONVERSATIONS_DEFAULT_LIMIT,
    backend.id,
    orgId,
  );
  const keyHash = JSON.stringify(queryKey);
  const subscribe = useCallback(
    (onChange: () => void) => queryClient.getQueryCache().subscribe(onChange),
    [queryClient],
  );
  const getSnapshot = useCallback(
    () =>
      queryClient.getQueryData<InfiniteData<AppConversationPage>>(
        JSON.parse(keyHash),
      ),
    [queryClient, keyHash],
  );
  const data = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return pickLatestRuntimeAcpModels(data?.pages, acpServerKey);
}
