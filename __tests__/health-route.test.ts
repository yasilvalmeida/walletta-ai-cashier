import { describe, it, expect } from "vitest";
import { GET } from "@/app/api/health/route";

describe("/api/health", () => {
  it("returns ok with a timestamp", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.status).toBe("ok");
    expect(typeof data.timestamp).toBe("string");
    // Must be an ISO8601 string so dashboards / uptime probes can
    // compare to `new Date(data.timestamp)`.
    expect(Number.isNaN(Date.parse(data.timestamp))).toBe(false);
  });
});
