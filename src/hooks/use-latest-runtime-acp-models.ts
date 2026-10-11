import { type InfiniteData, useQuery } from "@tanstack/react-query";
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
 * reported. Reads the sidebar's conversations query from the cache
 * (``enabled: false``): reactive, but never fetches and adds no dependency
 * on the sidebar's routing/auth gates to the chat input.
 */
export function useLatestRuntimeAcpModels(
  acpServerKey: string | null | undefined,
): AcpRuntimeModel[] {
  const { backend, orgId } = useActiveBackend();
  const { data } = useQuery<InfiniteData<AppConversationPage>>({
    queryKey: paginatedConversationsQueryKey(
      PAGINATED_CONVERSATIONS_DEFAULT_LIMIT,
      backend.id,
      orgId,
    ),
    enabled: false,
  });
  return pickLatestRuntimeAcpModels(data?.pages, acpServerKey);
}
