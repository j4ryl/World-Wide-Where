import type { DiscoveryCard } from "@planit/shared-schema";

export function getPlaceImageUrls(card: DiscoveryCard) {
  return card.imageUrls;
}
