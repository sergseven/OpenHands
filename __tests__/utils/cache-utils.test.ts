import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ActionEvent } from "#/types/agent-server/core/events/action-event";
import {
  handleAcpAgentStateCacheRefresh,
  handleActionEventCacheInvalidation,
} from "#/utils/cache-utils";
import { useModelStore } from "#/stores/model-store";

const makeActionEvent = (overrides: Partial<ActionEvent>): ActionEvent =>
  ({
    id: "ev-1",
    timestamp: new Date().toISOString(),
    source: "agent",
    tool_name: "SwitchLLMTool",
    tool_call_id: "call-1",
    action: { kind: "SwitchLLMAction" },
    ...overrides,
  }) as unknown as ActionEvent;

describe("handleActionEventCacheInvalidation", () => {
  beforeEach(() => {
    useModelStore.setState({
      entriesByConversation: {},
      activeProfileByConversation: {},
    });
  });

  it("refreshes the conversation and drops the optimistic profile when SwitchLLMTool fires", () => {
    useModelStore.setState({
      activeProfileByConversation: { "conv-1": "haiku" },
    });
    const queryClient = new QueryClient();
    const spy = vi.spyOn(queryClient, "invalidateQueries");

    handleActionEventCacheInvalidation(
      makeActionEvent({ tool_name: "SwitchLLMTool" }),
      "conv-1",
      queryClient,
    );

    expect(spy).toHaveBeenCalledWith({
      queryKey: ["user", "conversation", "conv-1"],
    });
    expect(
      useModelStore.getState().activeProfileByConversation["conv-1"],
    ).toBeUndefined();
  });

  it("does not touch the conversation cache for unrelated tool events", () => {
    const queryClient = new QueryClient();
    const spy = vi.spyOn(queryClient, "invalidateQueries");

    handleActionEventCacheInvalidation(
      makeActionEvent({ tool_name: "terminal" }),
      "conv-1",
      queryClient,
    );

    const conversationInvalidations = spy.mock.calls.filter(
      ([arg]) =>
        Array.isArray((arg as { queryKey?: unknown[] })?.queryKey) &&
        (arg as { queryKey: unknown[] }).queryKey[0] === "user",
    );
    expect(conversationInvalidations).toHaveLength(0);
  });
});

describe("handleAcpAgentStateCacheRefresh", () => {
  const key = ["user", "conversation", "conv-1", "backend-1", null];
  const agentState = (value: Record<string, unknown>) => ({
    kind: "ConversationStateUpdateEvent",
    key: "agent_state",
    value,
  });

  const setup = (cached: Record<string, unknown>) => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(key, cached);
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    return { queryClient, spy };
  };

  it("refetches when the session reports models the cached conversation lacks", () => {
    // The conversation is fetched before the ACP session starts, so its
    // runtime model list is empty until refetched.
    const { queryClient, spy } = setup({
      llm_model: "haiku",
      available_models: null,
    });

    handleAcpAgentStateCacheRefresh(
      agentState({
        acp_current_model_id: "haiku",
        acp_available_models: [{ model_id: "haiku", name: "Haiku" }],
      }),
      "conv-1",
      queryClient,
    );

    expect(spy).toHaveBeenCalledWith({
      queryKey: ["user", "conversation", "conv-1"],
    });
  });

  it("refetches when the session's current model differs from the cached one", () => {
    const { queryClient, spy } = setup({
      llm_model: "haiku",
      available_models: [{ model_id: "haiku" }, { model_id: "opus" }],
    });

    handleAcpAgentStateCacheRefresh(
      agentState({
        acp_current_model_id: "opus",
        acp_available_models: [{ model_id: "haiku" }, { model_id: "opus" }],
      }),
      "conv-1",
      queryClient,
    );

    expect(spy).toHaveBeenCalled();
  });

  it("does nothing when the cache already matches (every turn emits agent_state)", () => {
    const { queryClient, spy } = setup({
      llm_model: "haiku",
      available_models: [{ model_id: "haiku" }],
    });

    handleAcpAgentStateCacheRefresh(
      agentState({
        acp_current_model_id: "haiku",
        acp_available_models: [{ model_id: "haiku" }],
      }),
      "conv-1",
      queryClient,
    );
    handleAcpAgentStateCacheRefresh(
      { key: "stats", value: {} },
      "conv-1",
      queryClient,
    );

    expect(spy).not.toHaveBeenCalled();
  });

  it("reads full_state snapshots from value.agent_state", () => {
    const { queryClient, spy } = setup({
      llm_model: "haiku",
      available_models: null,
    });

    handleAcpAgentStateCacheRefresh(
      {
        key: "full_state",
        value: {
          agent_state: { acp_available_models: [{ model_id: "haiku" }] },
        },
      },
      "conv-1",
      queryClient,
    );

    expect(spy).toHaveBeenCalled();
  });

  it("refetches when nothing is cached yet (the first fetch may predate the session)", () => {
    const queryClient = new QueryClient();
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    const report = agentState({ acp_available_models: [{ model_id: "a" }] });

    handleAcpAgentStateCacheRefresh(report, "conv-1", queryClient);
    expect(spy).toHaveBeenCalledTimes(1);

    queryClient.setQueryData(key, null);
    handleAcpAgentStateCacheRefresh(report, "conv-1", queryClient);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("ignores agent_state without ACP model fields (native agents)", () => {
    const { queryClient, spy } = setup({
      llm_model: "gpt-5",
      available_models: null,
    });

    handleAcpAgentStateCacheRefresh(agentState({}), "conv-1", queryClient);

    expect(spy).not.toHaveBeenCalled();
  });
});
