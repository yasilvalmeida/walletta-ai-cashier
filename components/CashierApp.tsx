"use client";

import { POSPanel } from "@/components/pos/POSPanel";
import { AvatarPanel } from "@/components/avatar/AvatarPanel";

export function CashierApp() {
  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background">
      <div className="w-[45%] h-full">
        <POSPanel />
      </div>
      <div className="w-[55%] h-full">
        <AvatarPanel />
      </div>
    </div>
  );
}
