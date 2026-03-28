import type { DiscoveryCard } from "@planit/shared-schema";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000";

export function getPlaceImageUrls(card: DiscoveryCard) {
  return card.imageUrls.map((url) =>
    url.replace(/^https:\/\/localhost:3000\/api\/image-proxy/i, `${API_BASE_URL}/api/image-proxy`),
  );
}
