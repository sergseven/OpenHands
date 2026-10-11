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
 * Refresh the conversation when an ACP ``agent_state`` update carries model
 * state the cached conversation doesn't have yet. The conversation is first
 * fetched before the ACP session exists, so its ``available_models`` stays
 * empty (and the picker on the static registry) until the next 30 s poll —
 * which pauses in background tabs. Every prompt emits ``agent_state``, so
 * only refetch on a real difference: a list the cache lacks, or a different
 * current model.
 */
export const handleAcpAgentStateCacheRefresh = (
  event: { key: string; value?: unknown },
  conversationId: string,
  queryClient: QueryClient,
) => {
  if (event.key !== "agent_state" || !event.value) return;
  const state = event.value as {
    acp_available_models?: unknown[] | null;
    acp_current_model_id?: string | null;
  };
  const reportedModels = state.acp_available_models?.length ?? 0;
  const reportedCurrent = state.acp_current_model_id ?? null;
  if (!reportedModels && !reportedCurrent) return;

  const isStale = queryClient
    .getQueriesData<AppConversation | null>({
      queryKey: ["user", "conversation", conversationId],
    })
    .some(([, cached]) => {
      if (!cached) return false;
      const cachedModels = cached.available_models?.length ?? 0;
      return (
        (reportedModels > 0 && cachedModels === 0) ||
        (reportedCurrent !== null && cached.llm_model !== reportedCurrent)
      );
    });
  if (isStale) {
    queryClient.invalidateQueries({
      queryKey: ["user", "conversation", conversationId],
    });
  }
};
