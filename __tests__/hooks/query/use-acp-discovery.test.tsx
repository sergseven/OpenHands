import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useAcpDiscovery } from "#/hooks/query/use-acp-discovery";
import {
  acpModelScope,
  readRememberedAcpModels,
  rememberAcpModels,
} from "#/utils/remembered-acp-models";

const backendMock = vi.hoisted(() => ({
  current: {
    backend: { id: "local-1", kind: "local" as "local" | "cloud" },
    orgId: null as string | null,
  },
}));
vi.mock("#/contexts/active-backend-context", () => ({
  useActiveBackend: () => backendMock.current,
}));

vi.mock("#/hooks/query/use-get-secrets", () => ({
  useSearchSecrets: () => ({
    data: [{ name: "PI_AUTH_JSON" }, { name: "ANTHROPIC_API_KEY" }],
    isLoading: false,
  }),
}));

const discover = vi.hoisted(() => vi.fn());
vi.mock("#/api/acp-service/acp-service.api", () => ({
  default: {
    discover: (...args: unknown[]) => discover(...args),
  },
}));

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const PI_DISCOVERY = {
  agent_name: "pi-acp",
  agent_version: "0.0.33",
  current_model_id: "anthropic/claude-opus-4-8",
  available_models: [
    { model_id: "anthropic/claude-opus-4-8", name: "Claude Opus 4.8" },
    { model_id: "anthropic/claude-sonnet-5", name: null },
  ],
  supports_runtime_model_switch: true,
  error: null,
};

const ALL = acpModelScope(null);

const AUTH_REQUIRED = {
  ...PI_DISCOVERY,
  current_model_id: null,
  available_models: [],
  error: { code: "ACPAuthRequired", detail: "log in first" },
};

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  backendMock.current = {
    backend: { id: "local-1", kind: "local" },
    orgId: null,
  };
});

describe("useAcpDiscovery", () => {
  it("lists the commands the agent offers in the working dir", async () => {
    const commands = [
      {
        name: "backlog-show",
        description: "Show the backlog",
        input_hint: null,
      },
    ];
    discover.mockResolvedValue({
      ...PI_DISCOVERY,
      available_commands: commands,
    });

    const { result } = renderHook(
      () => useAcpDiscovery("pi", { workingDir: "/work/repo" }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.commands).toEqual(commands));
    expect(discover).toHaveBeenCalledWith(
      "pi",
      ["ANTHROPIC_API_KEY", "PI_AUTH_JSON"],
      "/work/repo",
    );
  });

  it("asks the local agent-server with every saved secret", async () => {
    discover.mockResolvedValue(PI_DISCOVERY);

    const { result } = renderHook(() => useAcpDiscovery("pi"), {
      wrapper,
    });

    await waitFor(() =>
      expect(result.current.defaultModelId).toBe("anthropic/claude-opus-4-8"),
    );
    expect(discover).toHaveBeenCalledWith(
      "pi",
      ["ANTHROPIC_API_KEY", "PI_AUTH_JSON"],
      null,
    );
    const models = [
      { id: "anthropic/claude-opus-4-8", label: "Claude Opus 4.8" },
      { id: "anthropic/claude-sonnet-5", label: "anthropic/claude-sonnet-5" },
    ];
    expect(result.current.models).toEqual(models);
    expect(result.current.source).toBe("live");
    expect(readRememberedAcpModels("local-1", "pi", ALL)).toEqual(models);
  });

  it("asks with only the secrets the launch would receive", async () => {
    discover.mockResolvedValue(PI_DISCOVERY);

    renderHook(
      () => useAcpDiscovery("pi", { secretRefs: ["PI_AUTH_JSON", "GONE"] }),
      { wrapper },
    );

    await waitFor(() =>
      expect(discover).toHaveBeenCalledWith("pi", ["PI_AUTH_JSON"], null),
    );
  });

  it("sends no secrets when the profile allows none", async () => {
    discover.mockResolvedValue(PI_DISCOVERY);

    renderHook(() => useAcpDiscovery("pi", { secretRefs: [] }), {
      wrapper,
    });

    await waitFor(() => expect(discover).toHaveBeenCalledWith("pi", [], null));
  });

  it("does not offer a list remembered with other secrets", async () => {
    rememberAcpModels("local-1", "pi", ALL, [
      { id: "anthropic/claude-opus-4-8", label: "Claude Opus 4.8" },
    ]);
    discover.mockResolvedValue(AUTH_REQUIRED);

    const { result } = renderHook(
      () => useAcpDiscovery("pi", { secretRefs: [] }),
      { wrapper },
    );

    await waitFor(() =>
      expect(result.current.discovery?.error?.code).toBe("ACPAuthRequired"),
    );
    expect(result.current.models).toEqual([]);
    expect(result.current.source).toBe("none");
  });

  it("offers the list remembered with the same secrets", async () => {
    const models = [{ id: "anthropic/claude-sonnet-5", label: "Sonnet 5" }];
    rememberAcpModels("local-1", "pi", acpModelScope(["PI_AUTH_JSON"]), models);
    discover.mockResolvedValue(AUTH_REQUIRED);

    const { result } = renderHook(
      () => useAcpDiscovery("pi", { secretRefs: ["PI_AUTH_JSON"] }),
      { wrapper },
    );

    await waitFor(() =>
      expect(result.current.discovery?.error?.code).toBe("ACPAuthRequired"),
    );
    expect(result.current.models).toEqual(models);
    expect(result.current.source).toBe("remembered");
  });

  it("remembers a scoped lookup without replacing the unscoped list", async () => {
    const unscoped = [{ id: "openai/gpt-6-astra", label: "GPT-6 Astra" }];
    rememberAcpModels("local-1", "pi", ALL, unscoped);
    discover.mockResolvedValue(PI_DISCOVERY);

    const { result } = renderHook(
      () => useAcpDiscovery("pi", { secretRefs: ["PI_AUTH_JSON"] }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.source).toBe("live"));
    expect(readRememberedAcpModels("local-1", "pi", ALL)).toEqual(unscoped);
    expect(
      readRememberedAcpModels("local-1", "pi", acpModelScope(["PI_AUTH_JSON"])),
    ).toEqual(result.current.models);
  });

  it("offers nothing while disabled, even a lookup it already made", async () => {
    discover.mockResolvedValue(PI_DISCOVERY);

    const { result, rerender } = renderHook(
      ({ enabled }) => useAcpDiscovery("pi", { enabled }),
      { wrapper, initialProps: { enabled: true } },
    );
    await waitFor(() => expect(result.current.source).toBe("live"));

    rerender({ enabled: false });

    expect(result.current.models).toEqual([]);
    expect(result.current.source).toBe("none");
    expect(result.current.defaultModelId).toBeNull();
  });

  it("has no models when the server cannot answer and none were seen", async () => {
    discover.mockRejectedValue(new Error("404"));

    const { result } = renderHook(() => useAcpDiscovery("pi"), {
      wrapper,
    });

    await waitFor(() => expect(discover).toHaveBeenCalled());
    await waitFor(() => expect(result.current.isDiscovering).toBe(false));
    expect(result.current.discovery).toBeNull();
    expect(result.current.models).toEqual([]);
    expect(result.current.source).toBe("none");
  });

  it("does not ask on a cloud backend", () => {
    backendMock.current = {
      backend: { id: "cloud-1", kind: "cloud" },
      orgId: null,
    };

    const { result } = renderHook(() => useAcpDiscovery("claude-code"), {
      wrapper,
    });

    expect(discover).not.toHaveBeenCalled();
    expect(result.current.models).toEqual([]);
    expect(result.current.source).toBe("none");
  });

  it("offers the list the agent last reported on this backend", () => {
    backendMock.current = {
      backend: { id: "cloud-1", kind: "cloud" },
      orgId: null,
    };
    const models = [{ id: "sonnet", label: "Sonnet" }];
    rememberAcpModels("cloud-1", "claude-code", ALL, models);
    rememberAcpModels("cloud-2", "codex", ALL, [
      { id: "gpt-5.5", label: "GPT" },
    ]);

    const { result } = renderHook(() => useAcpDiscovery("claude-code"), {
      wrapper,
    });

    expect(result.current.models).toEqual(models);
    expect(result.current.source).toBe("remembered");
    expect(result.current.defaultModelId).toBeNull();
  });

  it("picks up a list remembered after it mounted", () => {
    backendMock.current = {
      backend: { id: "cloud-1", kind: "cloud" },
      orgId: null,
    };
    const { result } = renderHook(() => useAcpDiscovery("claude-code"), {
      wrapper,
    });
    expect(result.current.models).toEqual([]);

    const models = [{ id: "sonnet", label: "Sonnet" }];
    act(() => rememberAcpModels("cloud-1", "claude-code", ALL, models));

    expect(result.current.models).toEqual(models);
    expect(result.current.source).toBe("remembered");
  });

  it("does not ask without a provider", () => {
    renderHook(() => useAcpDiscovery(null), { wrapper });

    expect(discover).not.toHaveBeenCalled();
  });
});
