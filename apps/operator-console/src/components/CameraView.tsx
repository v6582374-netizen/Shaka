import { useCallback, useEffect, useRef, useState } from "react";
import { relayCameraOffer } from "../api";
import { Icon } from "./Icon";
import { PanelHead } from "./PanelHead";

const CAMERA_HOST_KEY = "vegapunk:camera-host:v1";

const CAMERAS = [
  { id: "head", label: "Head stereo", detail: "1280 × 480 · left / right", aspect: "aspect-[8/3]", featured: true },
  { id: "leftWrist", label: "Left wrist", detail: "640 × 480", aspect: "aspect-[4/3]", featured: false },
  { id: "rightWrist", label: "Right wrist", detail: "640 × 480", aspect: "aspect-[4/3]", featured: false },
] as const;

type CameraId = (typeof CAMERAS)[number]["id"];
type CameraStatus = "idle" | "connecting" | "live" | "failed";
type CameraState = Record<CameraId, { status: CameraStatus; stream: MediaStream | null }>;

const initialState = (): CameraState => ({
  head: { status: "idle", stream: null },
  leftWrist: { status: "idle", stream: null },
  rightWrist: { status: "idle", stream: null },
});

const statusLabel: Record<CameraStatus, string> = {
  idle: "Ready",
  connecting: "Connecting…",
  live: "Live",
  failed: "Unavailable",
};

/**
 * The UI accepts a host or a copied camera URL, then deliberately discards
 * protocol, port and path so a pasted head-camera URL still starts the complete
 * camera set. Which port belongs to which pane is the relay's business, not the
 * page's: the browser never addresses a camera directly.
 */
export function normaliseRobotHost(input: string): string {
  const raw = input.trim();
  if (!raw) throw new Error("Enter the robot's local-network address.");

  let url: URL;
  try {
    url = new URL(raw.includes("://") ? raw : `https://${raw}`);
  } catch {
    throw new Error("Enter a valid robot address, for example 192.168.123.164.");
  }

  if (url.protocol !== "https:" || !url.hostname || url.username || url.password) {
    throw new Error("Enter only the robot address; credentials are not used to watch cameras.");
  }

  return url.hostname;
}

function waitForIceGathering(pc: RTCPeerConnection) {
  if (pc.iceGatheringState === "complete") return Promise.resolve();

  return new Promise<void>((resolve) => {
    const finish = () => {
      window.clearTimeout(timeout);
      pc.removeEventListener("icegatheringstatechange", onStateChange);
      resolve();
    };
    const onStateChange = () => {
      if (pc.iceGatheringState === "complete") finish();
    };
    const timeout = window.setTimeout(finish, 3_000);
    pc.addEventListener("icegatheringstatechange", onStateChange);
  });
}

function CameraFeed({
  label,
  detail,
  aspect,
  featured,
  status,
  stream,
}: {
  label: string;
  detail: string;
  aspect: string;
  featured: boolean;
  status: CameraStatus;
  stream: MediaStream | null;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.srcObject = stream;
    if (stream) video.play().catch(() => {});
    return () => {
      if (video.srcObject === stream) video.srcObject = null;
    };
  }, [stream]);

  return (
    <article
      className={(featured ? "xl:col-span-2 " : "") + "rounded-xl border border-line bg-panel overflow-hidden shadow-sm"}
      data-testid={`camera-feed-${label.toLowerCase().replace(/\s+/g, "-")}`}
    >
      <div className="flex items-center gap-2 px-3 py-2 border-b border-line bg-panel/80">
        <Icon name="image" size={15} className="text-faint shrink-0" />
        <span className="text-[13px] font-medium text-ink">{label}</span>
        <span className="text-[11.5px] text-faint">{detail}</span>
        <span className="ml-auto flex items-center gap-1.5 text-[11.5px] text-muted" aria-live="polite">
          <span
            className={
              "w-1.5 h-1.5 rounded-full " +
              (status === "live" ? "bg-ok" : status === "failed" ? "bg-danger" : "bg-faint")
            }
          />
          {statusLabel[status]}
        </span>
      </div>
      <div className={aspect + " relative bg-black"}>
        <video ref={videoRef} className="absolute inset-0 w-full h-full object-contain" autoPlay muted playsInline />
        {!stream && (
          <div className="absolute inset-0 grid place-items-center text-[12px] text-white/65">
            {status === "connecting" ? "Connecting to camera…" : status === "failed" ? "Camera unavailable" : "Waiting to start"}
          </div>
        )}
      </div>
    </article>
  );
}

export function CameraView() {
  const [host, setHost] = useState(() => localStorage.getItem(CAMERA_HOST_KEY) ?? "");
  const [activeHost, setActiveHost] = useState<string | null>(null);
  const [cameras, setCameras] = useState<CameraState>(initialState);
  const [message, setMessage] = useState<string | null>(null);
  const peers = useRef(new Map<CameraId, RTCPeerConnection>());
  const attempt = useRef(0);

  const closeAll = useCallback(() => {
    attempt.current += 1;
    for (const peer of peers.current.values()) peer.close();
    peers.current.clear();
  }, []);

  const stop = useCallback(() => {
    closeAll();
    setActiveHost(null);
    setCameras(initialState());
    setMessage(null);
  }, [closeAll]);

  useEffect(() => () => closeAll(), [closeAll]);

  const start = async () => {
    let normalizedHost: string;
    try {
      normalizedHost = normaliseRobotHost(host);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Enter a valid robot address.");
      return;
    }

    closeAll();
    const currentAttempt = attempt.current;
    localStorage.setItem(CAMERA_HOST_KEY, normalizedHost);
    setActiveHost(normalizedHost);
    setMessage(null);
    setCameras({
      head: { status: "connecting", stream: null },
      leftWrist: { status: "connecting", stream: null },
      rightWrist: { status: "connecting", stream: null },
    });

    await Promise.all(
      CAMERAS.map(async (camera) => {
        const peer = new RTCPeerConnection({ iceServers: [] });
        peers.current.set(camera.id, peer);

        const update = (next: Partial<CameraState[CameraId]>) => {
          if (attempt.current !== currentAttempt) return;
          setCameras((previous) => ({ ...previous, [camera.id]: { ...previous[camera.id], ...next } }));
        };

        peer.ontrack = (event) => {
          const stream = event.streams[0] ?? new MediaStream([event.track]);
          update({ status: "live", stream });
        };
        peer.onconnectionstatechange = () => {
          if (peer.connectionState === "failed") update({ status: "failed", stream: null });
        };

        try {
          peer.addTransceiver("video", { direction: "recvonly" });
          const offer = await peer.createOffer();
          await peer.setLocalDescription(offer);
          await waitForIceGathering(peer);

          // Signalling goes through the sidecar. The robot serves HTTPS with a
          // self-signed certificate that has no subjectAltName, which no browser can
          // be taught to trust, so the page cannot perform this exchange itself. The
          // video that follows is still a direct browser-to-robot WebRTC connection.
          const answer = await relayCameraOffer(camera.id, normalizedHost, {
            sdp: peer.localDescription?.sdp ?? "",
            type: peer.localDescription?.type ?? "offer",
          });
          await peer.setRemoteDescription(answer);
        } catch (error) {
          peer.close();
          update({ status: "failed", stream: null });
          if (attempt.current === currentAttempt) {
            setMessage(
              error instanceof Error
                ? error.message
                : "A camera could not connect. Check the robot address and try again.",
            );
          }
        }
      }),
    );
  };

  const streaming = activeHost !== null;

  return (
    <main className="flex-1 min-w-0 overflow-y-auto hairline-scroll bg-paper">
      <div className="max-w-6xl mx-auto px-7 py-6">
        <PanelHead title="Camera" sub="Live, read-only views from a Unitree robot on the local network." />

        <section className="rounded-xl border border-line bg-panel p-4 mb-5" aria-label="Camera connection">
          <div className="flex flex-col sm:flex-row gap-3 sm:items-end">
            <label className="flex-1 min-w-0">
              <span className="block text-[12px] font-medium text-muted mb-1.5">Robot address</span>
              <input
                value={host}
                onChange={(event) => setHost(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !streaming) void start();
                }}
                placeholder="192.168.123.164"
                inputMode="url"
                autoCapitalize="none"
                spellCheck={false}
                className="w-full rounded-lg border border-line bg-paper px-3 py-2 text-[13px] text-ink outline-none focus:border-accent"
                aria-label="Robot address"
              />
            </label>
            {streaming ? (
              <button
                type="button"
                className="rounded-lg border border-line px-4 py-2 text-[13px] font-medium text-muted hover:text-ink hover:bg-paper"
                onClick={stop}
              >
                Stop
              </button>
            ) : (
              <button
                type="button"
                className="rounded-lg bg-accent px-4 py-2 text-[13px] font-medium text-white hover:brightness-95 disabled:opacity-50"
                onClick={() => void start()}
                disabled={!host.trim()}
              >
                Start cameras
              </button>
            )}
          </div>
          <p className="mt-2 text-[12px] text-faint">
            Camera viewing needs only the robot address. It never sends motion commands or stores SSH credentials.
            {activeHost ? ` Connected to ${activeHost}.` : ""}
          </p>
          {message && <p className="mt-2 text-[12px] text-danger" role="alert">{message}</p>}
        </section>

        <section className="grid grid-cols-1 xl:grid-cols-2 gap-4" aria-label="Robot camera feeds">
          {CAMERAS.map((camera) => (
            <CameraFeed
              key={camera.id}
              label={camera.label}
              detail={camera.detail}
              aspect={camera.aspect}
              featured={camera.featured}
              status={cameras[camera.id].status}
              stream={cameras[camera.id].stream}
            />
          ))}
        </section>
      </div>
    </main>
  );
}
