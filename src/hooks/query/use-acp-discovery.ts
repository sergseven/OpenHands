import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type {
  ACPCommandInfo,
  ACPDiscovery,
} from "@openhands/typescript-client";
import AcpService from "#/api/acp-service/acp-service.api";
import { useActiveBackend } from "#/contexts/active-backend-context";
import { useSearchSecrets } from "#/hooks/query/use-get-secrets";
import { ACP_DISCOVERY_QUERY_KEYS } from "#/hooks/query/query-keys";
import {
  toAcpModelOptions,
  type ACPModelOption,
} from "#/constants/acp-providers";
import { useRememberedAcpModels } from "#/hooks/use-remembered-acp-models";
import {
  acpModelScope,
  rememberAcpModels,
} from "#/utils/remembered-acp-models";

const NO_COMMANDS: ACPCommandInfo[] = [];

async function discover(
  providerKey: string,
  secretNames: string[],
  workingDir: string | null,
): Promise<ACPDiscovery | null> {
  try {
    return await AcpService.discover(providerKey, secretNames, workingDir);
  } catch {
    // Older agent-servers lack the endpoint.
    return null;
  }
}

/** Where {@link useAcpDiscovery}'s ``models`` came from. */
export type AcpModelSource = "live" | "remembered" | "none";

/**
 * What a built-in ACP provider offers on the active backend, as its own server
 * reports it for the saved credentials: its models, the one it uses by
 * default, and the slash commands it lists in ``workingDir`` (null: none of
 * the project's). Only local backends can ask before a conversation starts;
 * otherwise ``models`` is the list the agent last reported with the same
 * secrets and ``commands`` is empty. ``secretRefs`` limits the lookup to the
 * secrets a launch would receive; null means every saved secret.
 */
export function useAcpDiscovery(
  providerKey: string | null | undefined,
  {
    enabled = true,
    secretRefs = null,
    workingDir = null,
  }: {
    enabled?: boolean;
    secretRefs?: readonly string[] | null;
    workingDir?: string | null;
  } = {},
) {
  const { backend } = useActiveBackend();
  const isLocal = backend.kind === "local";
  const secrets = useSearchSecrets({ enabled: enabled && isLocal });
  const secretNames = secrets.data
    .map(({ name }) => name)
    .filter((name) => !secretRefs || secretRefs.includes(name))
    .sort();
  const queryEnabled =
    enabled && isLocal && !!providerKey && !secrets.isLoading;

  const query = useQuery<ACPDiscovery | null, Error>({
    queryKey: [
      ...ACP_DISCOVERY_QUERY_KEYS.all,
      backend.id,
      providerKey,
      secretNames,
      workingDir,
    ],
    queryFn: () => discover(providerKey as string, secretNames, workingDir),
    enabled: queryEnabled,
    staleTime: 1000 * 60 * 5,
    gcTime: 1000 * 60 * 15,
    retry: false,
    refetchOnWindowFocus: false,
  });

  const scope = acpModelScope(secretRefs);
  const discovery = queryEnabled ? (query.data ?? null) : null;
  const liveModels = useMemo(
    () => toAcpModelOptions(discovery?.available_models),
    [discovery],
  );
  useEffect(() => {
    if (providerKey) {
      rememberAcpModels(backend.id, providerKey, scope, liveModels);
    }
  }, [backend.id, providerKey, scope, liveModels]);

  const remembered = useRememberedAcpModels(
    enabled ? providerKey : null,
    scope,
  );
  let models: ACPModelOption[] = [];
  let source: AcpModelSource = "none";
  if (liveModels.length) {
    models = liveModels;
    source = "live";
  } else if (remembered.length) {
    models = remembered;
    source = "remembered";
  }

  return {
    discovery,
    models,
    source,
    defaultModelId: discovery?.current_model_id ?? null,
    commands: discovery?.available_commands ?? NO_COMMANDS,
    isDiscovering: queryEnabled && query.isFetching && !query.data,
  };
}
