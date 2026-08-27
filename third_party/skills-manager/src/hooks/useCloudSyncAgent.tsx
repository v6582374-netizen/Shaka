// Stub implementation - Cloud sync hook removed

export const useCloudSync = () => ({
  syncing: false,
  lastSyncTime: null,
  authProfile: null,
  logout: async () => {},
  manualSync: async () => {},
  lastSyncedAt: null,
  syncStage: null,
  conflict: null,
  error: null,
  refreshVaultConsent: async () => {}
});
