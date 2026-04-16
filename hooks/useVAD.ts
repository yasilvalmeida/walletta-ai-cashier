"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { getSharedAudioContext } from "@/lib/audio";

const SPEECH_THRESHOLD = 15;
const SILENCE_DURATION_MS = 1500;
const CHECK_INTERVAL_MS = 100;

interface UseVADOptions {
  onSpeechStart?: () => void;
  onSpeechEnd?: () => void;
}

interface UseVADReturn {
  isSpeaking: boolean;
  isListening: boolean;
  startListening: (stream: MediaStream) => void;
  stopListening: () => void;
  volume: number;
}

export function useVAD(options: UseVADOptions = {}): UseVADReturn {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [volume, setVolume] = useState(0);

  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wasSpeakingRef = useRef(false);
  const optionsRef = useRef(options);

  useEffect(() => {
    optionsRef.current = options;
  }, [options]);

  const startListening = useCallback((stream: MediaStream) => {
    const audioContext = getSharedAudioContext();
    if (!audioContext) return;

    const source = audioContext.createMediaStreamSource(stream);
    sourceRef.current = source;
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.8;
    source.connect(analyser);
    analyserRef.current = analyser;

    const dataArray = new Uint8Array(analyser.frequencyBinCount);

    intervalRef.current = setInterval(() => {
      analyser.getByteFrequencyData(dataArray);
      const avg = dataArray.reduce((sum, val) => sum + val, 0) / dataArray.length;
      setVolume(avg);

      const speaking = avg > SPEECH_THRESHOLD;

      if (speaking) {
        // Clear any pending silence timer
        if (silenceTimerRef.current) {
          clearTimeout(silenceTimerRef.current);
          silenceTimerRef.current = null;
        }

        if (!wasSpeakingRef.current) {
          wasSpeakingRef.current = true;
          setIsSpeaking(true);
          optionsRef.current.onSpeechStart?.();
        }
      } else if (wasSpeakingRef.current && !silenceTimerRef.current) {
        // Start silence timer — end of speech after sustained silence
        silenceTimerRef.current = setTimeout(() => {
          wasSpeakingRef.current = false;
          setIsSpeaking(false);
          silenceTimerRef.current = null;
          optionsRef.current.onSpeechEnd?.();
        }, SILENCE_DURATION_MS);
      }
    }, CHECK_INTERVAL_MS);

    setIsListening(true);
  }, []);

  const stopListening = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
    // The AudioContext is shared with TTS + Deepgram — never close it here.
    // Only disconnect our analyser graph.
    if (sourceRef.current) {
      try {
        sourceRef.current.disconnect();
      } catch {
        // already disconnected
      }
      sourceRef.current = null;
    }
    if (analyserRef.current) {
      try {
        analyserRef.current.disconnect();
      } catch {
        // already disconnected
      }
      analyserRef.current = null;
    }
    wasSpeakingRef.current = false;
    setIsSpeaking(false);
    setIsListening(false);
    setVolume(0);
  }, []);

  return { isSpeaking, isListening, startListening, stopListening, volume };
}
