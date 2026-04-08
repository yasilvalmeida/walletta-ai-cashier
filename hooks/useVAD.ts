"use client";

import { useState, useCallback } from "react";

interface UseVADReturn {
  isSpeaking: boolean;
  isListening: boolean;
  startListening: () => void;
  stopListening: () => void;
}

export function useVAD(): UseVADReturn {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isListening, setIsListening] = useState(false);

  const startListening = useCallback(() => {
    setIsListening(true);
    setIsSpeaking(false);
  }, []);

  const stopListening = useCallback(() => {
    setIsListening(false);
    setIsSpeaking(false);
  }, []);

  return { isSpeaking, isListening, startListening, stopListening };
}
