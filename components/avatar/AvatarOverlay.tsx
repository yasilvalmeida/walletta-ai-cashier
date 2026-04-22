"use client";

import { motion, AnimatePresence } from "framer-motion";
import { STATUS_CONFIG } from "@/lib/overlay";
import type { OverlayStatus } from "@/lib/overlay";

interface AvatarOverlayProps {
  status: OverlayStatus;
}

// Per Temur's Apr 22 feedback the persistent status badge read as
// "dashboard chrome". We keep the component but render it only for
// transient, actionable states — connecting, processing, and error.
// Idle / listening / speaking / connected are conveyed by the avatar
// itself and the mic button, so we stay invisible there.
const TRANSIENT: ReadonlySet<OverlayStatus> = new Set([
  "connecting",
  "processing",
  "error",
]);

export function AvatarOverlay({ status }: AvatarOverlayProps) {
  const visible = TRANSIENT.has(status);
  const { label, color } = STATUS_CONFIG[status];

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          key={status}
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.18 }}
          className="flex items-center gap-2 backdrop-blur-md bg-black/50 rounded-full px-3 py-1.5 border border-white/10"
        >
          <span className={`w-2 h-2 rounded-full ${color} animate-pulse`} />
          <span className="font-sans text-xs text-white/70">{label}</span>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
