export interface TelemetryCloseHandlerWindow {
  onCloseRequested(
    handler: (event: { preventDefault(): void }) => void | Promise<void>,
  ): Promise<() => void>;
  destroy(): Promise<void>;
}

interface RegisterTelemetryCloseHandlerOptions {
  appWindow: TelemetryCloseHandlerWindow;
  endSession: (reason: string) => Promise<void>;
}

export async function registerTelemetryCloseHandler({
  appWindow,
  endSession,
}: RegisterTelemetryCloseHandlerOptions): Promise<() => void> {
  return appWindow.onCloseRequested(async (event) => {
    event.preventDefault();

    try {
      await endSession("normal_close");
    } finally {
      await appWindow.destroy();
    }
  });
}
