import { HealthResponseSchema } from "@happy-farm/contracts";

const statusElement = document.querySelector<HTMLElement>("#status");

async function showHealth(): Promise<void> {
  if (statusElement === null) return;
  try {
    const response = await fetch("/health");
    const body = HealthResponseSchema.safeParse(await response.json());
    statusElement.textContent = body.success ? "API foundation ready" : "API unavailable";
  } catch {
    statusElement.textContent = "API unavailable";
  }
}

void showHealth();
