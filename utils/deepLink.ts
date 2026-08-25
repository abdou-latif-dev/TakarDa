/** Deep link that reopens FormEase directly on the "join this group" screen. */
export function buildJoinLink(groupId: string): string {
  return `formease://join/${groupId}`;
}
