export interface LiveKitTokenResponse {
  token: string;
  url: string;
}

export async function fetchLiveKitToken(
  roomName: string,
  participantName: string
): Promise<LiveKitTokenResponse> {
  const res = await fetch("/api/livekit/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ roomName, participantName }),
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch LiveKit token: ${res.status}`);
  }

  return res.json() as Promise<LiveKitTokenResponse>;
}
