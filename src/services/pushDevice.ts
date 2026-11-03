// Ephemeral token cache used only to revoke this device at explicit logout.
// Do not persist native push tokens in localStorage or print full values.
let currentPushToken: string | null = null
export function rememberPushToken(token: string): void { currentPushToken = token }
export function getCurrentPushToken(): string | null { return currentPushToken }
export function forgetPushToken(): void { currentPushToken = null }
