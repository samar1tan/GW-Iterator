/** A confirmed write is consumed before refreshing its surrounding view. */
export async function submitKnowledgeChange<T>(confirmed: boolean, write: () => Promise<T>, onReceipt: (receipt: T) => void, refresh: () => Promise<void>): Promise<void> {
  if (!confirmed) onReceipt(await write());
  await refresh();
}
