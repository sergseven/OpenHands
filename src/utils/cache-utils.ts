import { QueryClient } from "@tanstack/react-query";
import type { ActionEvent } from "#/types/agent-server/core/events/action-event";
import type { AppConversation } from "#/api/conversation-service/agent-server-conversation-service.types";
import { useModelStore } from "#/stores/model-store";
import { stripWorkspacePrefix } from "./path-utils";

/**
 * Cache invalidation utilities for TanStack Query
 */

/**
 * Handle cache invalidation for ActionEvent
 * Invalidates relevant query caches based on the action type
 *
 * @param event - The ActionEvent to process
 * @param conversationId - The conversation ID for cache keys
 * @param queryClient - The TanStack Query client instance
 */
export const handleActionEventCacheInvalidation = (
  event: ActionEvent,
  conversationId: string,
  queryClient: QueryClient,
) => {
  const { action } = event;

  // Invalidate file_changes cache for file-related actions
  if (
    action.kind === "StrReplaceEditorAction" ||
    action.kind === "FileEditorAction" ||
    action.kind === "ExecuteBashAction"
  ) {
    queryClient.invalidateQueries(
      {
        queryKey: ["file_changes", conversationId],
      },
      { cancelRefetch: false },
    );
  }

  // Invalidate specific file diff cache for file modifications
  if (
    (action.kind === "StrReplaceEditorAction" ||
      action.kind === "FileEditorAction") &&
    action.path
  ) {
    const strippedPath = stripWorkspacePrefix(action.path);
    queryClient.invalidateQueries({
      queryKey: ["file_diff", conversationId, strippedPath],
    });
  }

  // When the agent autonomously swaps the LLM via SwitchLLMTool, refresh the
  // conversation so SwitchProfileButton / ChatInputModel pick up the new
  // `llm_model`, and drop any previously-set optimistic profile name (it
  // would now misrepresent the agent's choice).
  if (event.tool_name === "SwitchLLMTool") {
    queryClient.invalidateQueries({
      queryKey: ["user", "conversation", conversationId],
    });
    useModelStore.getState().clearActiveProfile(conversationId);
  }
};

/**
 * Refetch the conversation when an ACP state update carries model state the
 * cache lacks: the first fetch can predate the ACP session, leaving
 * ``available_models`` empty until the 30 s poll (paused in background tabs).
 * Every prompt emits ``agent_state``, so only refetch on a real difference.
 */
export const handleAcpAgentStateCacheRefresh = (
  event: { key: string; value?: unknown },
  conversationId: string,
  queryClient: QueryClient,
) => {
  if (!event.value) return;
  let state: unknown;
  if (event.key === "agent_state") state = event.value;
  else if (event.key === "full_state") {
    state = (event.value as { agent_state?: unknown }).agent_state;
  }
  if (!state) return;
  const { acp_available_models: models, acp_current_model_id: current } =
    state as {
      acp_available_models?: unknown[] | null;
      acp_current_model_id?: string | null;
    };
  const reportedModels = models?.length ?? 0;
  const reportedCurrent = current ?? null;
  if (!reportedModels && !reportedCurrent) return;

  const queryKey = ["user", "conversation", conversationId];
  const cachedEntries = queryClient
    .getQueriesData<AppConversation | null>({ queryKey })
    .filter(([, cached]) => cached);
  // Nothing cached yet: the in-flight first fetch may predate the session.
  const isStale =
    cachedEntries.length === 0 ||
    cachedEntries.some(([, cached]) => {
      const cachedModels = cached?.available_models?.length ?? 0;
      return (
        (reportedModels > 0 && cachedModels === 0) ||
        (reportedCurrent !== null && cached?.llm_model !== reportedCurrent)
      );
    });
  if (isStale) queryClient.invalidateQueries({ queryKey });
};
