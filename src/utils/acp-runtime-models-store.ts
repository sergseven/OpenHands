import type { AcpRuntimeModel } from "#/api/conversation-service/agent-server-conversation-service.types";
import { ACP_CUSTOM_PRESET_KEY } from "#/constants/acp-providers";

// The home screen has no ACP session to ask, so it shows the last model list
// an agent reported, remembered per backend and agent. A `custom` server only
// has an identity through its profile id.
const KEY_PREFIX = "OH_ACP_RUNTIME_MODELS";

export function acpRuntimeModelsIdentity(
  profileId: string | null | undefined,
  acpServer: string | null | undefined,
): string | null {
  if (profileId) return profileId;
  return acpServer && acpServer !== ACP_CUSTOM_PRESET_KEY ? acpServer : null;
}

const storageKey = (backendId: string, identity: string) =>
  `${KEY_PREFIX}:${backendId}:${identity}`;

const isRuntimeModels = (value: unknown): value is AcpRuntimeModel[] =>
  Array.isArray(value) &&
  value.every(
    (entry) =>
      typeof entry === "object" &&
      entry !== null &&
      typeof (entry as { model_id?: unknown }).model_id === "string",
  );

export function loadAcpRuntimeModels(
  backendId: string,
  identity: string | null,
): AcpRuntimeModel[] {
  if (!identity) return [];
  try {
    const stored = localStorage.getItem(storageKey(backendId, identity));
    const parsed: unknown = stored ? JSON.parse(stored) : null;
    return isRuntimeModels(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveAcpRuntimeModels(
  backendId: string,
  identity: string | null,
  models: readonly AcpRuntimeModel[],
) {
  if (!identity || models.length === 0) return;
  try {
    const value = JSON.stringify(models);
    const key = storageKey(backendId, identity);
    if (localStorage.getItem(key) !== value) localStorage.setItem(key, value);
  } catch {
    // Storage unavailable or full: the picker just keeps the static list.
  }
}
