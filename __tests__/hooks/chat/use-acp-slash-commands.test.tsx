import React from "react";
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAcpSlashCommands } from "#/hooks/chat/use-acp-slash-commands";
import { HomeWorkingDirContext } from "#/contexts/home-working-dir-context";

const useActiveConversationMock = vi.fn();
vi.mock("#/hooks/query/use-active-conversation", () => ({
  useActiveConversation: () => useActiveConversationMock(),
}));

vi.mock("#/hooks/query/use-settings", () => ({
  useSettings: () => ({ data: undefined }),
}));

const useAcpModelContextMock = vi.fn();
vi.mock("#/hooks/use-acp-model-context", () => ({
  useAcpModelContext: () => useAcpModelContextMock(),
}));

const useActiveAcpProfileDetailMock = vi.fn();
vi.mock("#/hooks/query/use-active-acp-profile-detail", () => ({
  useActiveAcpProfileDetail: () => useActiveAcpProfileDetailMock(),
}));

const useAcpDiscoveryMock = vi.fn();
vi.mock("#/hooks/query/use-acp-discovery", () => ({
  useAcpDiscovery: (...args: unknown[]) => useAcpDiscoveryMock(...args),
}));

const SESSION = [{ name: "compact", description: "Compact", input_hint: null }];
const DISCOVERED = [
  { name: "backlog-show", description: "Show the backlog", input_hint: null },
];

function homeWorkingDir(path: string | null) {
  function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <HomeWorkingDirContext.Provider value={path}>
        {children}
      </HomeWorkingDirContext.Provider>
    );
  }
  return Wrapper;
}

beforeEach(() => {
  vi.clearAllMocks();
  useActiveConversationMock.mockReturnValue({ data: undefined });
  useActiveAcpProfileDetailMock.mockReturnValue(null);
  useAcpDiscoveryMock.mockReturnValue({ commands: DISCOVERED });
});

describe("useAcpSlashCommands", () => {
  it("lists the ACP conversation's own session commands", () => {
    useActiveConversationMock.mockReturnValue({
      data: { agent_kind: "acp", acp_available_commands: SESSION },
    });
    useAcpModelContextMock.mockReturnValue({
      isActiveAcpConversation: true,
      isHomeAcp: false,
    });

    const { result } = renderHook(() => useAcpSlashCommands());

    expect(result.current).toEqual(SESSION);
  });

  it("on home, lists what the active profile's agent offers in the picked workspace", () => {
    useAcpModelContextMock.mockReturnValue({
      isActiveAcpConversation: false,
      isHomeAcp: true,
    });
    useActiveAcpProfileDetailMock.mockReturnValue({
      acp_server: "claude-code",
      secret_refs: ["ANTHROPIC_API_KEY"],
    });

    const { result } = renderHook(() => useAcpSlashCommands(), {
      wrapper: homeWorkingDir("/work/repo"),
    });

    expect(result.current).toEqual(DISCOVERED);
    expect(useAcpDiscoveryMock).toHaveBeenCalledWith("claude-code", {
      enabled: true,
      secretRefs: ["ANTHROPIC_API_KEY"],
      workingDir: "/work/repo",
    });
  });

  it("is null when the agent is not ACP", () => {
    useAcpModelContextMock.mockReturnValue({
      isActiveAcpConversation: false,
      isHomeAcp: false,
    });

    const { result } = renderHook(() => useAcpSlashCommands());

    expect(result.current).toBeNull();
    expect(useAcpDiscoveryMock).toHaveBeenCalledWith(null, expect.anything());
  });
});
