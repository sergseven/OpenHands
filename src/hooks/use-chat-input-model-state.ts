import { useEffect } from "react";
import { useActiveConversation } from "#/hooks/query/use-active-conversation";
import { useSettings } from "#/hooks/query/use-settings";
import {
  type AcpModelContext,
  useAcpModelContext,
} from "#/hooks/use-acp-model-context";
import { useActiveBackend } from "#/contexts/active-backend-context";
import { useCanManageOrgProfiles } from "#/hooks/use-can-manage-org-profiles";
import { useActiveAcpProfileDetail } from "#/hooks/query/use-active-acp-profile-detail";
import { useOptionalConversationId } from "#/hooks/use-conversation-id";
import {
  acpRuntimeModelsIdentity,
  loadAcpRuntimeModels,
  saveAcpRuntimeModels,
} from "#/utils/acp-runtime-models-store";
import {
  getAcpPreferredDefaultModel,
  getAcpProvider,
  labelForAcpModel,
  resolveEffectiveAcpModel,
  type ACPModelOption,
} from "#/constants/acp-providers";

export interface ChatInputModelState {
  isAcpContext: boolean;
  displayModel: string | null;
  currentModelId: string | null;
  availableAcpModels: ACPModelOption[];
  showAcpPicker: boolean;
  switchConversationId: string | null;
  destinationPath: AcpModelContext["destinationPath"];
  destinationLabel: string;
}

export function useChatInputModelState(): ChatInputModelState {
  const { data: conversation } = useActiveConversation();
  const { data: settings } = useSettings();
  const { conversationId } = useOptionalConversationId();
  const { backend } = useActiveBackend();
  const canManageOrgProfiles = useCanManageOrgProfiles();
  // The active ACP AgentProfile's own fields are the conversation launch
  // source (activation never writes agent_settings, so the global settings
  // may describe a different provider). Null in a conversation, while
  // loading, when the active profile isn't ACP, or on legacy backends
  // without the profiles surface — settings are the fallback in that window.
  const activeAcpProfile = useActiveAcpProfileDetail();
  const {
    isActiveAcpConversation,
    isHomeAcp,
    isAcpContext,
    destinationPath,
    destinationLabel,
  } = useAcpModelContext();

  const settingsAcpServerKey =
    typeof settings?.agent_settings?.acp_server === "string"
      ? settings.agent_settings.acp_server
      : null;
  const acpServerKey = isActiveAcpConversation
    ? conversation?.acp_server
    : isHomeAcp
      ? (activeAcpProfile?.acp_server ?? settingsAcpServerKey)
      : null;
  const acpProvider = isAcpContext ? getAcpProvider(acpServerKey) : undefined;

  const settingsAcpModel =
    typeof settings?.agent_settings?.acp_model === "string"
      ? settings.agent_settings.acp_model
      : null;
  // Home: read the model from the same source as the server key — mixing the
  // profile's provider with a stale settings model could pair e.g. a codex
  // provider with a claude model.
  const acpConfiguredModel =
    isHomeAcp && activeAcpProfile
      ? activeAcpProfile.acp_model
      : settingsAcpModel;

  // Runtime model catalogue the ACP server reported for the active session
  // (``available_models``, agent-server >= 1.51.0). Preferred over the static
  // registry: it is the only source that lists models for a ``custom`` ACP
  // profile, and for built-in providers it reflects the credentials actually
  // configured. Only an active conversation has a live session to report it.
  // Home has no session: it shows the list last remembered for this agent.
  const activeRuntimeModels = conversation?.available_models;
  const activeIdentity = acpRuntimeModelsIdentity(
    conversation?.launched_agent_profile?.agent_profile_id,
    conversation?.acp_server,
  );
  useEffect(() => {
    if (isActiveAcpConversation && activeRuntimeModels) {
      saveAcpRuntimeModels(backend.id, activeIdentity, activeRuntimeModels);
    }
  }, [
    isActiveAcpConversation,
    backend.id,
    activeIdentity,
    activeRuntimeModels,
  ]);
  const runtimeAcpModels = isActiveAcpConversation
    ? (activeRuntimeModels ?? [])
    : isHomeAcp
      ? loadAcpRuntimeModels(
          backend.id,
          acpRuntimeModelsIdentity(activeAcpProfile?.id, acpServerKey),
        )
      : [];

  let currentModelId: string | null = null;
  if (isActiveAcpConversation) {
    // ACP conversations store llm_model as the acp_model (persisted at
    // creation time). Use it directly if available; fall back to the
    // settings-configured model or provider default so the chip stays visible.
    currentModelId =
      conversation?.llm_model ??
      resolveEffectiveAcpModel({
        configured: acpConfiguredModel,
        providerDefault: getAcpPreferredDefaultModel(acpServerKey),
      });
  } else if (isHomeAcp) {
    currentModelId = resolveEffectiveAcpModel({
      configured: acpConfiguredModel,
      // Preferred default (Vertex-safe for Gemini) — must match what the
      // start request would substitute for an unconfigured model.
      providerDefault: getAcpPreferredDefaultModel(acpServerKey),
    });
  } else {
    currentModelId = conversation?.llm_model ?? settings?.llm_model ?? null;
  }

  // Chip label precedence: the matching runtime entry's ``name`` (a custom
  // server's own wording, e.g. ``swe-2-high`` → "SWE 2 High"), then the
  // static registry label (``sonnet`` → "Claude Sonnet"), then the raw id
  // (``labelForAcpModel`` already falls back to it for unknown ids).
  const runtimeCurrentModel = runtimeAcpModels.find(
    (modelEntry) => modelEntry.model_id === currentModelId,
  );
  const displayModel =
    currentModelId && isAcpContext
      ? (runtimeCurrentModel?.name ??
        labelForAcpModel(acpServerKey, currentModelId) ??
        currentModelId)
      : currentModelId;
  const availableAcpModels =
    runtimeAcpModels.length > 0
      ? runtimeAcpModels.map((model) => ({
          id: model.model_id,
          label: model.name ?? model.model_id,
          ...(model.description ? { description: model.description } : {}),
        }))
      : (acpProvider?.available_models ?? []);
  // A home-page pick persists into the active ACP profile, which on cloud is
  // org-owned — hide the selectable rows from members who'd only get a 403.
  // Conversation-scoped switches (blank or started) stay member-allowed.
  const canPersistHomeAcpModel =
    !isHomeAcp || backend.kind !== "cloud" || canManageOrgProfiles;
  const showAcpPicker =
    isAcpContext && availableAcpModels.length > 0 && canPersistHomeAcpModel;
  const switchConversationId = isActiveAcpConversation
    ? (conversationId ?? null)
    : null;

  return {
    isAcpContext,
    displayModel,
    currentModelId,
    availableAcpModels,
    showAcpPicker,
    switchConversationId,
    destinationPath,
    destinationLabel,
  };
}
