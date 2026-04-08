"use client";

import { POSPanel } from "@/components/pos/POSPanel";
import { AvatarPanel } from "@/components/avatar/AvatarPanel";
import { useConversation } from "@/hooks/useConversation";

export function CashierApp() {
  const conversation = useConversation();

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background">
      <div className="w-[45%] h-full">
        <POSPanel
          transcript={conversation.transcript}
          assistantText={conversation.assistantText}
          phase={conversation.phase}
        />
      </div>
      <div className="w-[55%] h-full">
        <AvatarPanel
          phase={conversation.phase}
          isSpeaking={conversation.isSpeaking}
          volume={conversation.volume}
          transcript={conversation.transcript}
          assistantText={conversation.assistantText}
          error={conversation.error}
          deepgramStatus={conversation.deepgramStatus}
          onStart={conversation.start}
          onStop={conversation.stop}
          isListening={conversation.isListening}
        />
      </div>
    </div>
  );
}
