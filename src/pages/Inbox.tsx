import { ConversationList } from "@/components/inbox/ConversationList";
import { ConversationThread } from "@/components/inbox/ConversationThread";
import { ConversationDetails } from "@/components/inbox/ConversationDetails";
import { useInboxStore } from "@/stores/useInboxStore";

export default function Inbox() {
  const activeId = useInboxStore((s) => s.activeConversationId);

  return (
    <div className="flex h-full w-full overflow-hidden gap-2">
      {/* Col 1 — Conversation list (320px, 4 tabs) */}
      <ConversationList />

      {/* Col 2 — Thread + composer */}
      <ConversationThread />

      {/* Col 3 — Details panel (only when a conversation is selected) */}
      {activeId && <ConversationDetails />}
    </div>
  );
}
