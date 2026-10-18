import React from "react";
import { HomeWorkingDirContext } from "#/contexts/home-working-dir-context";
import { useActiveConversation } from "#/hooks/query/use-active-conversation";

/**
 * The directory ACP discovery should open its session in: the active
 * conversation's workspace, or the one picked in the home launcher. Both the
 * model picker and the slash menu pass it, so they share one discovery.
 */
export function useAcpWorkingDir(): string | null {
  const { data: conversation } = useActiveConversation();
  const homeWorkingDir = React.useContext(HomeWorkingDirContext);
  return conversation
    ? (conversation.selected_workspace ?? null)
    : homeWorkingDir;
}
