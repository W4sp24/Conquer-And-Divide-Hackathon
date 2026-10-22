// In-app live video: the seller's camera goes peer-to-peer to every viewer's phone.
// The backend only relays the SDP offer/answer (see api/app/rtc.py). Non-trickle ICE:
// each side waits for its ICE candidates before sending, so one round trip is enough.
import { pub, seller } from './api'

const ICE: RTCConfiguration = {
  iceServers: [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }],
}

function waitForIce(pc: RTCPeerConnection, ms = 2500): Promise<void> {
  if (pc.iceGatheringState === 'complete') return Promise.resolve()
  return new Promise((resolve) => {
    const done = () => {
      pc.removeEventListener('icegatheringstatechange', check)
      resolve()
    }
    const check = () => pc.iceGatheringState === 'complete' && done()
    pc.addEventListener('icegatheringstatechange', check)
    setTimeout(done, ms) // good enough: host + srflx candidates are usually in by now
  })
}

/** Seller side: answers each viewer's offer with the camera stream. */
export class Broadcaster {
  private peers = new Map<string, RTCPeerConnection>()
  sessionId: string
  stream: MediaStream
  constructor(sessionId: string, stream: MediaStream) {
    this.sessionId = sessionId
    this.stream = stream
  }

  get viewerCount() {
    return [...this.peers.values()].filter((p) => p.connectionState === 'connected').length
  }

  async handleOffer(peerId: string, sdp: string) {
    this.peers.get(peerId)?.close()
    const pc = new RTCPeerConnection(ICE)
    this.peers.set(peerId, pc)
    pc.onconnectionstatechange = () => {
      if (['failed', 'closed', 'disconnected'].includes(pc.connectionState)) {
        setTimeout(() => {
          if (pc.connectionState !== 'connected') {
            pc.close()
            if (this.peers.get(peerId) === pc) this.peers.delete(peerId)
          }
        }, 4000)
      }
    }
    this.stream.getTracks().forEach((t) => pc.addTrack(t, this.stream))
    await pc.setRemoteDescription({ type: 'offer', sdp })
    await pc.setLocalDescription(await pc.createAnswer())
    await waitForIce(pc)
    await seller.post(`/sessions/${this.sessionId}/rtc/answer`, { peer_id: peerId, sdp: pc.localDescription!.sdp })
  }

  replaceStream(stream: MediaStream) {
    this.stream = stream
    for (const pc of this.peers.values()) {
      for (const sender of pc.getSenders()) {
        const t = stream.getTracks().find((x) => x.kind === sender.track?.kind)
        if (t) sender.replaceTrack(t)
      }
    }
  }

  stop() {
    this.peers.forEach((p) => p.close())
    this.peers.clear()
  }
}

/** Viewer side: offer to receive video+audio, then poll for the seller's answer. */
export async function watch(sessionId: string, onStream: (s: MediaStream) => void,
                            onState: (s: RTCPeerConnectionState) => void): Promise<RTCPeerConnection> {
  const pc = new RTCPeerConnection(ICE)
  pc.addTransceiver('video', { direction: 'recvonly' })
  pc.addTransceiver('audio', { direction: 'recvonly' })
  pc.ontrack = (e) => onStream(e.streams[0] ?? new MediaStream([e.track]))
  pc.onconnectionstatechange = () => onState(pc.connectionState)
  await pc.setLocalDescription(await pc.createOffer())
  await waitForIce(pc)
  const peerId = 'v_' + Math.random().toString(36).slice(2, 12) + Date.now().toString(36)
  await pub.post(`/public/sessions/${sessionId}/rtc/offer`, { peer_id: peerId, sdp: pc.localDescription!.sdp })
  for (let i = 0; i < 40; i++) {
    const { sdp } = await pub.get<{ sdp: string | null }>(`/public/rtc/${peerId}/answer`)
    if (sdp) {
      await pc.setRemoteDescription({ type: 'answer', sdp })
      return pc
    }
    await new Promise((r) => setTimeout(r, 400))
  }
  pc.close()
  throw new Error('The seller’s camera didn’t answer. Try again in a moment.')
}
