import type { ACPCommandInfo } from "@openhands/typescript-client";
import { getAcpProvider } from "#/constants/acp-providers";
import { useAcpDiscovery } from "#/hooks/query/use-acp-discovery";
import { useActiveAcpProfileDetail } from "#/hooks/query/use-active-acp-profile-detail";
import { useActiveConversation } from "#/hooks/query/use-active-conversation";
import { useSettings } from "#/hooks/query/use-settings";
import { useAcpModelContext } from "#/hooks/use-acp-model-context";
import { useAcpWorkingDir } from "#/hooks/use-acp-working-dir";

/**
 * The slash commands the ACP agent itself advertises, or null when the agent
 * is not ACP. In a conversation: its session's latest list. On the home page:
 * what the next conversation's agent lists in the picked workspace, from
 * discovery (shared with the model picker).
 */
export function useAcpSlashCommands(): ACPCommandInfo[] | null {
  const { data: conversation } = useActiveConversation();
  const { data: settings } = useSettings();
  const { isActiveAcpConversation, isHomeAcp } = useAcpModelContext();
  const activeAcpProfile = useActiveAcpProfileDetail();
  const workingDir = useAcpWorkingDir();

  const settingsAcpServer =
    typeof settings?.agent_settings?.acp_server === "string"
      ? settings.agent_settings.acp_server
      : null;
  const homeServer = activeAcpProfile?.acp_server ?? settingsAcpServer;
  const discovered = useAcpDiscovery(
    isHomeAcp && getAcpProvider(homeServer) ? homeServer : null,
    {
      enabled: !!activeAcpProfile,
      secretRefs: activeAcpProfile?.secret_refs ?? null,
      workingDir,
    },
  );

  if (isActiveAcpConversation) {
    return conversation?.acp_available_commands ?? [];
  }
  return isHomeAcp ? discovered.commands : null;
}
